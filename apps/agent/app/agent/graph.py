"""The conversation as a graph — the routing and identity decisions of
DESIGN.md, made runnable.

The line became a graph the moment turns stopped being alike: a question
about DeFi in general has no business paying a portfolio fetch, and a
question about the user's money deserves one. Nodes are steps, a typed state
flows through them, conditional edges pick the branch. The graph has no
cycles; the one loop lives inside the grounded node, the agentic tool loop.

    START -> pending_gate -> [proposal waiting?]
              | no                \\-> yes+confirmed -> create_portfolio ► END
              v                   \\-> yes+declined -> cancel_creation ─► END
            classify_intent -> [intent?] -> general ───────────────────► END
                                        \\-> earn ──────────────────────► END
                                        \\-> identity -> [?] -> grounded ► END
                                                    \\-> onboard ───────► END
                                                    \\-> unavailable ───► END

The identity node resolves WHOSE portfolio a money question is about: the
widget's slug is a hint that short-circuits the lookup; without it, the host
says who the caller is and what they own. An EMPTY portfolio list means
onboarding; an identity lookup ERROR means the degraded answer — a hiccuping
API must never tell a person they own nothing.

The pending gate is the write gate: creating a portfolio takes two turns by
construction. The onboarding branch can only PROPOSE, and only this gate,
reading a clear yes on a later turn, reaches the one node that writes.

The classifier's failure mode is chosen: on any error the turn routes to the
identity branch, so a broken classifier degrades to yesterday's behaviour and
never to a worse answer about money.
"""

import logging
from collections.abc import AsyncIterator
from typing import Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from ..adapters.earn import YieldCatalog
from ..adapters.portfolio import PortfolioApiSource
from ..config import Config
from ..domain.conversation import Turn
from ..observability import metrics
from ..ports import Ask, Failed, Finished, Progress, Reply, Update
from .context import earning_lines, positions_read
from .intent import IntentClassifier
from .llm import Models, extract_text
from .onboarding import (
    ConfirmationClassifier,
    ProposePortfolio,
    create_portfolio_with_wallets,
    sanitize_addresses,
)
from .prompts import (
    cancelled_prompt,
    confirmation_request_prompt,
    created_prompt,
    creation_failed_prompt,
    degraded_prompt,
    earn_prompt,
    grounded_prompt,
    nothing_proposed_prompt,
    onboarding_prompt,
    system_prompt,
)
from .steps import said, step
from .streaming import turn_events
from .tools import earn_tools, portfolio_tools, run_tools

logger = logging.getLogger("svinooh-ai")


class AgentState(TypedDict, total=False):
    """What flows through the graph — each node reads some keys, writes others."""

    question: str
    #: The exchanges to replay, as the conversation stored them.
    history: tuple[Turn, ...]
    # The widget's hint about which portfolio is on screen, and the caller's
    # token to fetch it with — both may be absent.
    portfolio: str | None
    authorization: str | None
    # The session's proposed-but-unconfirmed action, loaded by the route layer.
    pending_addresses: list[str] | None
    # Written by classify_intent; the first conditional edge routes on it.
    intent: str
    # Written by identity: where the portfolio branch goes, and in which
    # portfolio to ground when it goes to `grounded`.
    route: str
    target_portfolio: str
    # Written by the branch that answered.
    answer: str
    # Orders back to the session store: stash this proposal / drop the current
    # one. The graph stays pure — it never touches the store itself.
    pending_set: list[str]
    pending_clear: bool
    #: The slug just created, for the route layer to remember on the
    #: conversation — the graph names it and never stores it itself.
    portfolio_created: str


#: The nodes a turn can end on, and therefore the only nodes whose tokens are
#: the answer somebody is reading. A leaf is where the turn stops, which is
#: where the reply gets written; everything upstream also talks to a model and
#: none of that is for the reader. One tuple, so a branch added below is
#: streamed without anybody remembering to say so.
ANSWERING_NODES = (
    "general",
    "earn",
    "grounded",
    "onboard",
    "create_portfolio",
    "cancel_creation",
    "unavailable",
)


class LangGraphAgent:
    """ports.Agent as a LangGraph StateGraph.

    Nothing in a node reaches for a global: the dials, the portfolio API, the
    model clients and the two classifiers arrive through the constructor.
    That is what lets a test run the real graph over fakes, and the container
    (app/container.py) build one per process.
    """

    def __init__(
        self,
        config: Config,
        portfolio: PortfolioApiSource,
        catalog: YieldCatalog,
        models: Models,
        intents: IntentClassifier,
        confirmations: ConfirmationClassifier,
    ) -> None:
        self._config = config
        self._portfolio = portfolio
        self._catalog = catalog
        self._models = models
        self._intents = intents
        self._confirmations = confirmations
        self.graph = self._build()

    async def run(self, ask: Ask) -> Reply:
        """One turn, awaited: the answer, once it is finished."""
        return _reply(await self.graph.ainvoke(_state(ask)))

    async def watch(self, ask: Ask) -> AsyncIterator[Update]:
        """The same turn, reported while it happens.

        The graph is watched rather than awaited (app/agent/streaming.py) and
        what it reports is said again in the port's own words, so the layer
        above never learns which library ran underneath.
        """
        watched = turn_events(self.graph, dict(_state(ask)), answering=ANSWERING_NODES)
        async for kind, payload in watched:
            if kind == "done":
                yield Finished(_reply(payload))
            elif kind == "error":
                yield Failed(str(payload.get("message", "")))
            else:
                yield Progress(kind="step" if kind == "step" else "token", payload=payload)

    # ── the nodes ───────────────────────────────────────────────────────────

    async def _pending_gate(self, state: AgentState) -> AgentState:
        """The front door once a proposal is waiting: the write gate.

        With no pending action, a pass-through to classification. With one,
        the user's reply is read as an answer to "create it?": a clear yes goes
        to the one node that writes, a clear no cancels, and anything else
        keeps the proposal waiting and lets the turn flow normally, so a
        question asked mid-confirmation still gets its answer.
        """
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
            # A yes is a yes with or without a token: the write node picks the
            # door (owned, or the host's ownerless one) from the token it has.
            return {"route": "create_portfolio"}
        if verdict.decision == "cancel":
            return {"route": "cancel_creation"}
        return {"route": "classify_intent"}

    async def _classify_intent(self, state: AgentState) -> AgentState:
        """Label the turn; on any failure, route where money questions are safe."""
        try:
            async with step("route", "Reading the question"):
                label = await self._intents.classify(state["question"])
            logger.info("intent: %s (%s) q=%.80s", label.intent, label.reason, state["question"])
            metrics.counted(metrics.intents, intent=label.intent)
            return {"intent": label.intent}
        except Exception as error:  # noqa: BLE001 — the fail-safe IS the handling
            logger.warning("intent classifier failed (%r) — routing to portfolio", error)
            # Counted apart from the label it falls back to: a router that
            # fails on every request looks exactly like one that finds every
            # question to be about money, which is how it hid twice.
            metrics.counted(metrics.intents, intent="unreadable")
            metrics.counted(metrics.errors, type="classifier")
            return {"intent": "portfolio"}

    async def _identity(self, state: AgentState) -> AgentState:
        """Whose portfolio is this conversation about?

        Identity is data in the state, not a guard in a handler: this node
        writes `route` and the conditional edge acts on it.
        """
        hint = state.get("portfolio")
        if hint:
            # A portfolio on screen is the portfolio the question is about,
            # signed in or not: the fetch carries whatever token the caller
            # has, and the API decides what that caller may read.
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
        # Their first portfolio stands in for "theirs" until the conversation
        # can pick between several — a refinement the state has room for.
        target = me.portfolios[0].slug
        logger.info("identity: owns %d -> grounded in %s", len(me.portfolios), target)
        return {"route": "grounded", "target_portfolio": target}

    async def _general(self, state: AgentState) -> AgentState:
        """A general question: answer directly, with no portfolio fetch."""
        return await self._answer(system_prompt(self._config), state)

    async def _earn(self, state: AgentState) -> AgentState:
        """Where to put money: the catalog, plus what the user already earns."""
        system = earn_prompt(system_prompt(self._config), await self._already_earning(state))
        return await self._answer_with_tools(system, state, earn_tools(self._catalog))

    async def _already_earning(self, state: AgentState) -> str:
        """The user's earning positions, or nothing — a visitor still gets advice."""
        target = state.get("portfolio")
        token = state.get("authorization")
        try:
            if not target:
                if not token:
                    return ""
                owned = (await self._portfolio.me(token)).portfolios
                if not owned:
                    return ""
                target = owned[0].slug
            async with step("portfolio", f"Reading portfolio · {target}"):
                portfolio = await self._portfolio.portfolio(target, token)
                said(positions_read(portfolio))
                return earning_lines(portfolio)
        except Exception as error:  # noqa: BLE001 — advice without it beats no advice
            logger.warning("earn: holdings unavailable (%r)", error)
            return ""

    async def _grounded(self, state: AgentState) -> AgentState:
        """Ground the answer in the target portfolio, and let the model drill down.

        The agentic loop: the model answers with the context block, or calls a
        read-only tool; the service executes it and the result returns as a
        message, until the model answers in text or the hop cap ends the loop
        — gently, with one last call and no tools bound.

        Degrades honestly: a slow or down API makes the answer general, not
        absent, and with no data there are no tools to drill into it with.
        """
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
        """A portfolio question with no portfolio behind it: onboard in the chat.

        The model converses with the ProposePortfolio tool bound; its docstring
        IS the instruction the model reads. A tool call here creates nothing:
        it becomes the session's pending action plus a confirmation question,
        and the write waits for the gate on a later turn. Signed out is the
        same branch, not a wall: what sign-in changes is only WHICH portfolio
        gets made, and so what the prompts must disclose before making it.
        """
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
            # Nothing was proposed. If the person nonetheless just said yes,
            # they are agreeing to something that does not exist — and in
            # production the model answered exactly that with "Done, the
            # portfolio is live". What was not proposed cannot have been
            # created, so the answer is not left to be improvised.
            if await self._reads_as_a_yes(state["question"]):
                logger.info("onboarding: a yes with nothing behind it")
                return await self._answer(
                    nothing_proposed_prompt(system_prompt(self._config)), state
                )
            # Otherwise the conversation is still collecting addresses.
            return {"answer": extract_text(reply)}

        addresses = sanitize_addresses(calls[0].get("args", {}).get("addresses", []))
        if not addresses:
            # The model called the tool with nothing usable; ask again rather
            # than propose an empty portfolio.
            return await self._answer(system, state)

        logger.info("onboarding: proposing %d wallet(s)", len(addresses))
        confirmation = await self._answer(
            confirmation_request_prompt(system_prompt(self._config), addresses, not signed_in),
            state,
        )
        return {**confirmation, "pending_set": addresses}

    async def _create_portfolio(self, state: AgentState) -> AgentState:
        """The one node that writes — reachable only through a confirmed gate.

        The create failing keeps the proposal, so a later yes retries; a single
        wallet failing does not sink the rest, and the answer relays the
        partial result honestly. The token decides which door: an owned
        portfolio, or the host's ownerless one for a visitor.
        """
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
            # Appended rather than asked for: the link is the only way back
            # to a portfolio nobody owns, and a model that abbreviates it or
            # promises it later has lost it for good. A path is
            # language-neutral, so this costs the answer nothing.
            #
            # Only when it is not already there, so a model that writes it
            # anyway does not end its reply with the same link twice.
            link = f"/p/{result.slug}"
            written = answered["answer"]
            outcome["answer"] = written if link in written else f"{written}\n\n{link}"
        return outcome

    async def _cancel_creation(self, state: AgentState) -> AgentState:
        """A declined proposal: drop it and say so — nothing was created."""
        answered = await self._answer(cancelled_prompt(system_prompt(self._config)), state)
        return {**answered, "pending_clear": True}

    async def _unavailable(self, state: AgentState) -> AgentState:
        """Identity could not be resolved: answer, and say the numbers are out of reach."""
        return await self._answer(degraded_prompt(system_prompt(self._config)), state)

    async def _reads_as_a_yes(self, question: str) -> bool:
        """Whether a reply is a plain confirmation, for a branch that has none.

        The same classifier the write gate uses, asked in the one other place
        a yes can arrive: an unreadable reply is not one, because guessing
        wrong here would answer a question nobody asked.
        """
        try:
            async with step("confirm", "Reading your reply"):
                verdict = await self._confirmations.classify(question)
        except Exception as error:  # noqa: BLE001 — an unreadable reply is not a yes
            logger.warning("confirmation classifier failed (%r) — reading it as not a yes", error)
            return False
        return verdict.decision == "confirm"

    # ── shared by the nodes ─────────────────────────────────────────────────

    @staticmethod
    def _messages(system: str, state: AgentState) -> list[BaseMessage]:
        """The prompt, the conversation so far, and the question being asked."""
        messages: list[BaseMessage] = [SystemMessage(content=system)]
        for turn in state.get("history", ()):
            messages += [HumanMessage(content=turn.q), AIMessage(content=turn.a)]
        messages.append(HumanMessage(content=state["question"]))
        return messages

    async def _answer_with_tools(self, system: str, state: AgentState, tools: list) -> AgentState:
        """Answer, letting the model call tools and read the results, until it stops.

        Ends on the model's own word or on the hop cap — and the cap ends it
        with one last call with nothing bound, so a turn finishes in prose
        rather than in a tool call nobody will run.
        """
        if not tools:
            return await self._answer(system, state)

        messages = self._messages(system, state)
        role = self._config.answering()
        for hop in range(self._config.tool_hops()):
            # The first hop is thinking about the question; the ones after it
            # are thinking about what the tools came back with.
            async with step(f"think-{hop}", "Thinking" if hop == 0 else "Reading what came back"):
                reply = await self._models.ask(
                    role, messages, prepare=lambda model: model.bind_tools(tools)
                )
            calls = getattr(reply, "tool_calls", None) or []
            if not calls:
                return {"answer": extract_text(reply)}
            messages.append(reply)
            messages.extend(await run_tools(calls, tools))
        async with step("answer", "Writing the answer"):
            final = await self._models.ask(role, messages)
        return {"answer": extract_text(final)}

    async def _answer(self, system: str, state: AgentState) -> AgentState:
        # The model call is an operation like any other, and until it was
        # reported it was the longest unlit stretch of a turn.
        async with step("answer", "Writing the answer"):
            reply = await self._models.ask(self._config.answering(), self._messages(system, state))
        return {"answer": extract_text(reply)}

    def _build(self) -> CompiledStateGraph:
        builder = StateGraph(AgentState)
        # Node names carry the domain, not the mechanism: "create_portfolio",
        # never "execute". The edges below are the topology, and compile()
        # checks that every referenced name exists.
        builder.add_node("pending_gate", self._pending_gate)
        builder.add_node("classify_intent", self._classify_intent)
        builder.add_node("identity", self._identity)
        builder.add_node("general", self._general)
        builder.add_node("earn", self._earn)
        builder.add_node("grounded", self._grounded)
        builder.add_node("onboard", self._onboard)
        builder.add_node("create_portfolio", self._create_portfolio)
        builder.add_node("cancel_creation", self._cancel_creation)
        builder.add_node("unavailable", self._unavailable)

        builder.add_edge(START, "pending_gate")
        # Each conditional edge is a router: it reads what the previous node
        # wrote and names the next one. The mappings are explicit so a value
        # nobody wired fails loudly here instead of wandering the graph.
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
            {"portfolio": "identity", "earn": "earn", "general": "general"},
        )
        builder.add_conditional_edges(
            "identity",
            lambda state: state["route"],
            {"grounded": "grounded", "onboard": "onboard", "unavailable": "unavailable"},
        )
        for leaf in ANSWERING_NODES:
            builder.add_edge(leaf, END)
        return builder.compile()


def _state(ask: Ask) -> AgentState:
    """The turn's request, as the state the nodes read."""
    return {
        "question": ask.question,
        "history": ask.history,
        "portfolio": ask.portfolio,
        "authorization": ask.authorization,
        "pending_addresses": list(ask.pending_addresses) if ask.pending_addresses else None,
    }


def _reply(state: dict[str, Any]) -> Reply:
    """What the graph left in the state, as the answer and its orders."""
    created = state.get("portfolio_created")
    pending = state.get("pending_set")
    return Reply(
        answer=str(state.get("answer", "")),
        pending_set=tuple(pending) if pending else None,
        pending_clear=bool(state.get("pending_clear")),
        portfolio_created=str(created) if created else None,
    )
