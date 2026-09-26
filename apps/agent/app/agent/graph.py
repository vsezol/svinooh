import asyncio
import logging
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from ..adapters.earn import YieldCatalog
from ..adapters.memory import MemoryStrategies
from ..adapters.portfolio import PortfolioApiSource
from ..config import Config
from ..domain import lpdown
from ..domain.asking import Choice
from ..domain.conversation import Turn
from ..domain.earn import Card, Held, LiquidityPosition, Placement, Settled
from ..domain.portfolio import Portfolio
from ..observability import metrics
from ..ports import Ask, Failed, Finished, Progress, Reply, Strategies, Update
from .context import (
    earning_lines,
    free_on_solana,
    held_lines,
    idle_lines,
    placed_lines,
    positions_read,
    replayed,
    without_what_the_chain_read,
)
from .intent import IntentClassifier
from .llm import Models, extract_text
from .onboarding import (
    ConfirmationClassifier,
    ProposePortfolio,
    create_portfolio_with_wallets,
    sanitize_addresses,
)
from .prompts import (
    WRITTEN_ONCE,
    cancelled_prompt,
    confirmation_request_prompt,
    created_prompt,
    creation_failed_prompt,
    degraded_prompt,
    earn_prompt,
    going_on_prompt,
    grounded_prompt,
    in_language,
    nothing_proposed_prompt,
    onboarding_prompt,
    settled_prompt,
    system_prompt,
)
from .steps import said, step
from .streaming import BETWEEN_REPLIES, turn_events
from .tools import (
    asking_tools,
    deposit_tools,
    earn_tools,
    liquidity_tools,
    lpdown_tools,
    moving_tools,
    portfolio_tools,
    run_tools,
)

logger = logging.getLogger("svinooh-ai")

IN_WORDS = (
    "(Nothing more can be looked up this turn. Write the answer now, in words, from what "
    "came back.)"
)

NOTHING_READY = (
    "(Nothing was prepared for them to sign in this turn: no card and no button is on their "
    "screen. Write the answer now, in words: say what stands in the way or what you need from "
    "them, and never that something is ready to sign.)"
)

CLAIMS_A_CARD = re.compile(r"\b(card|button)s?\b|карточк|кнопк", re.IGNORECASE)


def each_once(prepared: list[Card]) -> tuple[Card, ...]:
    """Every card the turn prepared, one per thing to sign: a later one for the same wins."""
    latest: dict[tuple[str, str, str | None], Card] = {}
    for card in prepared:
        if isinstance(card, Placement):
            which = card.position.address if card.position else None
        else:
            which = card.source.id if card.source else None
        latest[(card.action, card.pool.id, which)] = card
    return tuple(latest.values())


@dataclass(frozen=True)
class Holdings:
    """What the earn branch reads of somebody's money before it answers.

    `owners` are the Solana wallets it was read from: where a coin somebody
    names is looked for first.
    """

    idle: str = ""
    earning: str = ""
    held: tuple[Held, ...] = ()
    owners: tuple[str, ...] = ()
    placed: tuple[LiquidityPosition, ...] = ()
    free: dict[str, Decimal] | None = None
    portfolio: str | None = None


class AgentState(TypedDict, total=False):
    question: str
    history: tuple[Turn, ...]
    portfolio: str | None
    authorization: str | None
    pending_addresses: list[str] | None
    settled: Settled | None
    intent: str
    asked_to_place: bool
    risk: str
    lp_range: str
    language: str
    deposits: tuple[Card, ...]
    choices: tuple[Choice, ...]
    route: str
    target_portfolio: str
    answer: str
    pending_set: list[str]
    pending_clear: bool
    portfolio_created: str


ANSWERING_NODES = (
    "general",
    "earn",
    "settled",
    "grounded",
    "onboard",
    "create_portfolio",
    "cancel_creation",
    "unavailable",
)

ANSWERED_WHOLE = ("settled",)

SPEAKING_NODES = tuple(node for node in ANSWERING_NODES if node not in ANSWERED_WHOLE)


class LangGraphAgent:
    def __init__(
        self,
        config: Config,
        portfolio: PortfolioApiSource,
        catalog: YieldCatalog,
        models: Models,
        intents: IntentClassifier,
        confirmations: ConfirmationClassifier,
        strategies: Strategies | None = None,
    ) -> None:
        self._config = config
        self._portfolio = portfolio
        self._catalog = catalog
        self._models = models
        self._intents = intents
        self._confirmations = confirmations
        self._strategies = strategies if strategies is not None else MemoryStrategies()
        self.graph = self._build()

    async def run(self, ask: Ask) -> Reply:
        return _reply(await self.graph.ainvoke(_state(ask)))

    async def watch(self, ask: Ask) -> AsyncIterator[Update]:
        watched = turn_events(self.graph, dict(_state(ask)), answering=SPEAKING_NODES)
        async for kind, payload in watched:
            if kind == "done":
                yield Finished(_reply(payload))
            elif kind == "error":
                yield Failed(str(payload.get("message", "")))
            else:
                yield Progress(kind="step" if kind == "step" else "token", payload=payload)

    async def _pending_gate(self, state: AgentState) -> AgentState:
        if not state.get("pending_addresses"):
            return {"route": "classify_intent"}
        try:
            async with step("confirm", "Reading your reply"):
                verdict = await self._confirmations.classify(state["question"])
        except Exception as error:  # noqa: BLE001 — an unreadable reply must not write
            logger.warning("confirmation classifier failed (%r) — keeping the proposal", error)
            return {"route": "classify_intent"}
        logger.info("confirmation: %s (%s)", verdict.decision, verdict.reason)
        if verdict.decision == "confirm":
            return {"route": "create_portfolio"}
        if verdict.decision == "cancel":
            return {"route": "cancel_creation"}
        return {"route": "classify_intent"}

    async def _classify_intent(self, state: AgentState) -> AgentState:
        # A deposit coming back is not something the user typed, so its wording
        # decides neither the branch nor the language: what they last wrote does.
        asked = _last_question(state) if state.get("settled") else state["question"]
        commanded = not state.get("settled") and lpdown.is_command(asked)
        going_on = not state.get("settled") and lpdown.started(asked, state.get("history", ()))
        try:
            async with step("route", "Reading the question"):
                label = await self._intents.classify(asked, state.get("history", ()))
            logger.info(
                "intent: %s %s in %s, risk %s (%s) q=%.80s",
                label.intent,
                label.stance,
                label.language,
                label.risk,
                label.reason,
                asked,
            )
            metrics.counted(metrics.intents, intent=label.intent)
            placing = commanded or (going_on and label.intent == "general")
            return {
                "intent": "earn" if placing else _branch(state, label.intent),
                "asked_to_place": label.stance == "placing",
                "risk": label.risk,
                "lp_range": label.lp_range,
                "language": label.language,
            }
        except Exception as error:  # noqa: BLE001 — the fail-safe IS the handling
            logger.warning("intent classifier failed (%r) — routing to portfolio", error)
            metrics.counted(metrics.intents, intent="unreadable")
            metrics.counted(metrics.errors, type="classifier")
            return {"intent": "earn" if commanded else _branch(state, "portfolio")}

    async def _identity(self, state: AgentState) -> AgentState:
        hint = state.get("portfolio")
        if hint:
            return {"route": "grounded", "target_portfolio": hint}

        auth = state.get("authorization")
        if not auth:
            logger.info("identity: no token, no portfolio -> onboard")
            return {"route": "onboard"}

        try:
            async with step("account", "Checking your account"):
                me = await self._portfolio.me(auth)
        except Exception as error:  # noqa: BLE001 — an error is NOT an empty list
            logger.warning("identity lookup failed: %r", error)
            metrics.counted(metrics.errors, type="identity")
            return {"route": "unavailable"}

        if not me.portfolios:
            logger.info("identity: owns none -> onboard")
            return {"route": "onboard"}
        target = me.portfolios[0].slug
        logger.info("identity: owns %d -> grounded in %s", len(me.portfolios), target)
        return {"route": "grounded", "target_portfolio": target}

    async def _general(self, state: AgentState) -> AgentState:
        return await self._answer(system_prompt(self._config), state)

    async def _settled(self, state: AgentState) -> AgentState:
        settled = state.get("settled")
        if settled is None:
            return await self._general(state)
        logger.info("deposit %s: %s", settled.status, (settled.signature or "-")[:8])
        if settled.status == "landed" and not settled.halfway:
            return await self._earn(state, settled)
        return await self._answer(settled_prompt(system_prompt(self._config), settled), state)

    async def _earn(self, state: AgentState, settled: Settled | None = None) -> AgentState:
        asked_to_place = bool(state.get("asked_to_place"))
        holdings = await self._what_they_hold(state)
        if settled is not None and settled.status == "landed":
            await self._remember(settled, holdings)
        started = lpdown.started(state["question"], state.get("history", ()))
        if settled is None:
            system = earn_prompt(
                system_prompt(self._config),
                holdings.idle,
                holdings.earning,
                asked_to_place=asked_to_place,
                held=held_lines(holdings.held),
                placed=placed_lines(holdings.placed),
                lpdown=started,
            )
        else:
            system = going_on_prompt(
                system_prompt(self._config),
                settled,
                holdings.idle,
                held_lines(holdings.held),
                placed_lines(holdings.placed),
            )
        prepared: list[Card] = []
        asked: list[Choice] = []
        running = (
            await self._strategies.lpdown(holdings.portfolio)
            if holdings.portfolio is not None
            else frozenset()
        )
        risk_known = state.get("risk", "unknown") != "unknown"
        range_known = state.get("lp_range", "unknown") != "unknown"
        tools = (
            earn_tools(self._catalog)
            + deposit_tools(self._catalog, prepared, risk_known, holdings.owners)
            + moving_tools(self._catalog, holdings.held, prepared, risk_known, holdings.owners)
            + liquidity_tools(
                self._catalog,
                holdings.placed,
                prepared,
                range_known,
                holdings.free,
                holdings.held,
                holdings.owners,
                lpdown=running,
            )
            + (
                lpdown_tools(self._catalog, prepared, holdings.owners, holdings.free)
                if started
                else []
            )
            + asking_tools(asked)
        )
        answered = await self._answer_with_tools(
            system,
            state,
            tools,
            waiting=lambda: bool(asked),
            nothing_ready=lambda: not prepared and not asked,
        )
        if settled is not None and not prepared and not asked:
            answered = await self._without_a_card(system, state, answered)
        return {
            **answered,
            "deposits": () if asked else each_once(prepared),
            "choices": tuple(asked),
        }

    async def _remember(self, settled: Settled, holdings: Holdings) -> None:
        """Which positions /lpdown moves: the one its card opened, and no longer one it closed."""
        portfolio = holdings.portfolio
        if portfolio is None:
            return
        try:
            if settled.position and settled.action in ("close", "rebalance"):
                await self._strategies.drop(portfolio, settled.position)
            if settled.strategy != lpdown.STRATEGY or not settled.signature:
                return
            for owner in holdings.owners:
                opened = await self._catalog.opened_by(settled.signature, owner)
                for address in opened:
                    await self._strategies.adopt(portfolio, address)
                if opened:
                    logger.info("lpdown: %s opened %s", settled.signature[:8], opened)
                    return
            logger.warning(
                "lpdown: %s landed and no position it opened was found", settled.signature[:8]
            )
        except Exception as error:  # noqa: BLE001 — the answer about the landing still goes out
            logger.warning("lpdown: what %s opened could not be kept (%r)", settled.action, error)

    async def _what_they_hold(self, state: AgentState) -> Holdings:
        target = state.get("portfolio")
        token = state.get("authorization")
        try:
            if not target:
                if not token:
                    return Holdings()
                owned = (await self._portfolio.me(token)).portfolios
                if not owned:
                    return Holdings()
                target = owned[0].slug
            async with step("portfolio", f"Reading portfolio · {target}"):
                portfolio = await self._portfolio.portfolio(target, token)
                said(positions_read(portfolio))
            read, placed = await asyncio.gather(self._in_pools(portfolio), self._placed(portfolio))
            return Holdings(
                idle=idle_lines(portfolio),
                earning=earning_lines(without_what_the_chain_read(portfolio, read, bool(placed))),
                held=tuple(one for each in read.values() for one in each),
                owners=solana_wallets(portfolio),
                placed=placed,
                free=free_on_solana(portfolio),
                portfolio=target,
            )
        except Exception as error:  # noqa: BLE001 — advice without it beats no advice
            logger.warning("earn: holdings unavailable (%r)", error)
            return Holdings()

    async def _in_pools(self, portfolio: Portfolio) -> dict[str, tuple[Held, ...]]:
        """What every Solana wallet in the portfolio has in pools, read from the chain."""
        addresses = solana_wallets(portfolio)
        if not addresses:
            return {}
        try:
            async with step("held", "Reading what is in pools"):
                found = await asyncio.gather(*(self._catalog.positions(a) for a in addresses))
                count = sum(len(each) for each in found)
                said(f"{count} in pools" if count else "nothing in pools")
        except Exception as error:  # noqa: BLE001 — a deposit is still worth offering without it
            logger.warning("earn: positions unavailable (%r)", error)
            return {}
        return dict(zip(addresses, found, strict=True))

    async def _placed(self, portfolio: Portfolio) -> tuple[LiquidityPosition, ...]:
        """What every Solana wallet in the portfolio has placed as liquidity for a pair."""
        addresses = solana_wallets(portfolio)
        if not addresses:
            return ()
        try:
            async with step("placed", "Reading liquidity positions"):
                found = await asyncio.gather(
                    *(self._catalog.liquidity_positions(a) for a in addresses)
                )
                placed = tuple(one for each in found for one in each)
                said(f"{len(placed)} positions" if placed else "no liquidity positions")
        except Exception as error:  # noqa: BLE001 — the rest of the answer does not need it
            logger.warning("earn: liquidity positions unavailable (%r)", error)
            return ()
        return placed

    async def _grounded(self, state: AgentState) -> AgentState:
        system = system_prompt(self._config)
        tools: list = []
        target = state["target_portfolio"]
        token = state.get("authorization")
        try:
            async with step("portfolio", f"Reading portfolio · {target}"):
                portfolio = await self._portfolio.portfolio(target, token)
                said(positions_read(portfolio))
            system = grounded_prompt(system, portfolio, self._config.context_max_positions())
            tools = portfolio_tools(self._portfolio, target, token, portfolio)
        except Exception as error:  # noqa: BLE001 — any fetch failure degrades the same way
            logger.warning("portfolio context fetch failed for %s: %r", target, error)
            metrics.counted(metrics.errors, type="portfolio")
            system = degraded_prompt(system)
        return await self._answer_with_tools(system, state, tools)

    async def _onboard(self, state: AgentState) -> AgentState:
        signed_in = bool(state.get("authorization"))
        system = onboarding_prompt(system_prompt(self._config), signed_in)
        messages = self._messages(system, state)
        async with step("think-0", "Thinking"):
            reply = await self._models.ask(
                self._config.answering(),
                messages,
                prepare=lambda model: model.bind_tools([ProposePortfolio]),
            )

        calls = getattr(reply, "tool_calls", None) or []
        if not calls:
            if await self._reads_as_a_yes(state["question"]):
                logger.info("onboarding: a yes with nothing behind it")
                return await self._answer(
                    nothing_proposed_prompt(system_prompt(self._config)), state
                )
            return {"answer": extract_text(reply)}

        before = extract_text(reply)
        addresses = sanitize_addresses(calls[0].get("args", {}).get("addresses", []))
        if not addresses:
            answered = await self._answer(system, state)
            return {"answer": all_that_was_said([before, answered["answer"]])}

        logger.info("onboarding: proposing %d wallet(s)", len(addresses))
        confirmation = await self._answer(
            confirmation_request_prompt(system_prompt(self._config), addresses, not signed_in),
            state,
        )
        return {
            "answer": all_that_was_said([before, confirmation["answer"]]),
            "pending_set": addresses,
        }

    async def _create_portfolio(self, state: AgentState) -> AgentState:
        addresses = state.get("pending_addresses") or []
        try:
            wallets = f"{len(addresses)} wallet" + ("" if len(addresses) == 1 else "s")
            async with step("create", f"Creating the portfolio · {wallets}"):
                result = await create_portfolio_with_wallets(
                    self._portfolio, addresses, state.get("authorization")
                )
        except Exception as error:  # noqa: BLE001 — nothing was created; say so
            logger.warning("portfolio creation failed: %r", error)
            return await self._answer(creation_failed_prompt(system_prompt(self._config)), state)
        logger.info(
            "onboarding: created %s (+%d wallets, %d refused)",
            result.slug,
            len(result.added),
            len(result.refused),
        )
        answered = await self._answer(created_prompt(system_prompt(self._config), result), state)
        outcome: AgentState = {**answered, "pending_clear": True}
        if result.slug:
            outcome["portfolio_created"] = result.slug
            link = f"/p/{result.slug}"
            written = answered["answer"]
            outcome["answer"] = written if link in written else f"{written}\n\n{link}"
        return outcome

    async def _cancel_creation(self, state: AgentState) -> AgentState:
        answered = await self._answer(cancelled_prompt(system_prompt(self._config)), state)
        return {**answered, "pending_clear": True}

    async def _unavailable(self, state: AgentState) -> AgentState:
        return await self._answer(degraded_prompt(system_prompt(self._config)), state)

    async def _reads_as_a_yes(self, question: str) -> bool:
        try:
            async with step("confirm", "Reading your reply"):
                verdict = await self._confirmations.classify(question)
        except Exception as error:  # noqa: BLE001 — an unreadable reply is not a yes
            logger.warning("confirmation classifier failed (%r) — reading it as not a yes", error)
            return False
        return verdict.decision == "confirm"

    @staticmethod
    def _messages(system: str, state: AgentState) -> list[BaseMessage]:
        messages: list[BaseMessage] = [
            SystemMessage(content=in_language(system, state.get("language")))
        ]
        for turn in state.get("history", ()):
            asked, answered = replayed(turn)
            messages += [HumanMessage(content=asked), AIMessage(content=answered)]
        messages.append(HumanMessage(content=state["question"]))
        return messages

    async def _answer_with_tools(
        self,
        system: str,
        state: AgentState,
        tools: list,
        waiting: Callable[[], bool] = lambda: False,
        nothing_ready: Callable[[], bool] = lambda: False,
    ) -> AgentState:
        """Answer with tools until the model is done, or until the turn is.

        `waiting` is the turn's own knowledge that it has put something to the
        user that only they can answer. From then on another hop has nothing
        to find and everything to spoil: on 2026-09-21 it asked the same
        question twice, and prepared a move on a guess at the very risk it had
        just asked about, then said the card was on screen when the question
        was. So the turn ends there, with whatever line came with the question.
        """
        if not tools:
            return await self._answer(system, state)

        messages = self._messages(f"{system}\n\n{WRITTEN_ONCE}", state)
        role = self._config.answering()
        written: list[str] = []
        for hop in range(self._config.tool_hops()):
            async with step(f"think-{hop}", "Thinking" if hop == 0 else "Reading what came back"):
                reply = await self._models.ask(
                    role, messages, prepare=lambda model: model.bind_tools(tools)
                )
            written.append(extract_text(reply))
            calls = getattr(reply, "tool_calls", None) or []
            if not calls:
                return {"answer": all_that_was_said(written)}
            messages.append(reply)
            messages.extend(await run_tools(calls, tools))
            if waiting():
                return {"answer": all_that_was_said(written)}
        logger.warning(
            "tool budget spent after %d hops — answering without another tool",
            self._config.tool_hops(),
        )
        async with step("answer", "Writing the answer"):
            said("the tool budget was spent")
            if nothing_ready():
                messages.append(HumanMessage(content=NOTHING_READY))
            written.append(extract_text(await self._models.ask(role, messages)))
            if not all_that_was_said(written):
                # A model that ends on a tool's result with no tools left to call
                # can answer with nothing at all — on 2026-09-21 a turn went out
                # empty that way. Told plainly what is wanted, it answers.
                again = await self._models.ask(role, [*messages, HumanMessage(content=IN_WORDS)])
                written.append(extract_text(again))
        return {"answer": all_that_was_said(written)}

    async def _without_a_card(
        self, system: str, state: AgentState, answered: AgentState
    ) -> AgentState:
        written = str(answered.get("answer", ""))
        if not CLAIMS_A_CARD.search(written):
            return answered
        logger.warning("settled: the answer names a card that was never prepared, asking again")
        return await self._answer(f"{system}\n\n{NOTHING_READY}", state)

    async def _answer(self, system: str, state: AgentState) -> AgentState:
        async with step("answer", "Writing the answer"):
            reply = await self._models.ask(self._config.answering(), self._messages(system, state))
        return {"answer": extract_text(reply)}

    def _build(self) -> CompiledStateGraph:
        builder = StateGraph(AgentState)
        builder.add_node("pending_gate", self._pending_gate)
        builder.add_node("classify_intent", self._classify_intent)
        builder.add_node("identity", self._identity)
        builder.add_node("general", self._general)
        builder.add_node("settled", self._settled)
        builder.add_node("earn", self._earn)
        builder.add_node("grounded", self._grounded)
        builder.add_node("onboard", self._onboard)
        builder.add_node("create_portfolio", self._create_portfolio)
        builder.add_node("cancel_creation", self._cancel_creation)
        builder.add_node("unavailable", self._unavailable)

        builder.add_edge(START, "pending_gate")
        builder.add_conditional_edges(
            "pending_gate",
            lambda state: state["route"],
            {
                "classify_intent": "classify_intent",
                "create_portfolio": "create_portfolio",
                "cancel_creation": "cancel_creation",
            },
        )
        builder.add_conditional_edges(
            "classify_intent",
            lambda state: state["intent"],
            {
                "portfolio": "identity",
                "earn": "earn",
                "general": "general",
                "settled": "settled",
            },
        )
        builder.add_conditional_edges(
            "identity",
            lambda state: state["route"],
            {"grounded": "grounded", "onboard": "onboard", "unavailable": "unavailable"},
        )
        for leaf in ANSWERING_NODES:
            builder.add_edge(leaf, END)
        return builder.compile()


def all_that_was_said(written: list[str]) -> str:
    return BETWEEN_REPLIES.join(one.strip() for one in written if one.strip())


def solana_wallets(portfolio: Portfolio) -> tuple[str, ...]:
    return tuple(wallet.address for wallet in portfolio.wallets if wallet.chain == "SOL")


def _branch(state: AgentState, intent: str) -> str:
    return "settled" if state.get("settled") else intent


def _last_question(state: AgentState) -> str:
    spoken = [turn.q for turn in state.get("history", ()) if turn.q]
    return spoken[-1] if spoken else state["question"]


def _state(ask: Ask) -> AgentState:
    return {
        "question": ask.question,
        "history": ask.history,
        "portfolio": ask.portfolio,
        "authorization": ask.authorization,
        "pending_addresses": list(ask.pending_addresses) if ask.pending_addresses else None,
        "settled": ask.settled,
    }


def _reply(state: dict[str, Any]) -> Reply:
    created = state.get("portfolio_created")
    pending = state.get("pending_set")
    return Reply(
        answer=str(state.get("answer", "")),
        pending_set=tuple(pending) if pending else None,
        pending_clear=bool(state.get("pending_clear")),
        portfolio_created=str(created) if created else None,
        deposits=tuple(state.get("deposits") or ()),
        choices=state.get("choices") or (),
    )
