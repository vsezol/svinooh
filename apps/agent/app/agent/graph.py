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

from ..adapters.portfolio import PortfolioApiSource
from ..config import Config
from ..domain.conversation import Turn
from .context import (
    cancelled_prompt,
    confirmation_request_prompt,
    created_prompt,
    creation_failed_prompt,
    degraded_prompt,
    grounded_prompt,
    onboarding_prompt,
)
from .intent import IntentClassifier
from .llm import Models, extract_text
from .onboarding import (
    ConfirmationClassifier,
    ProposePortfolio,
    create_portfolio_with_wallets,
    sanitize_addresses,
)
from .steps import step
from .streaming import turn_events
from .tools import portfolio_tools, run_tools

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
    "grounded",
    "onboard",
    "create_portfolio",
    "cancel_creation",
    "unavailable",
)


class Agent:
    """The graph, built once with everything its nodes need.

    Nothing in a node reaches for a global: the dials, the portfolio API, the
    model clients and the two classifiers arrive through the constructor.
    That is what lets a test run the real graph over fakes, and the container
    (app/container.py) build one per process.
    """

    def __init__(
        self,
        config: Config,
        portfolio: PortfolioApiSource,
        models: Models,
        intents: IntentClassifier,
        confirmations: ConfirmationClassifier,
    ) -> None:
        self._config = config
        self._portfolio = portfolio
        self._models = models
        self._intents = intents
        self._confirmations = confirmations
        self.graph = self._build()

    async def run(self, state: AgentState) -> dict[str, Any]:
        """One turn, awaited: the final state, answer included."""
        return await self.graph.ainvoke(state)

    def watch(self, state: AgentState) -> AsyncIterator[tuple[str, dict]]:
        """The same turn, reported while it happens (app/agent/streaming.py)."""
        return turn_events(self.graph, dict(state), answering=ANSWERING_NODES)

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
            return {"intent": label.intent}
        except Exception as error:  # noqa: BLE001 — the fail-safe IS the handling
            logger.warning("intent classifier failed (%r) — routing to portfolio", error)
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
        return await self._answer(self._config.system_prompt(), state)

    async def _grounded(self, state: AgentState) -> AgentState:
        """Ground the answer in the target portfolio, and let the model drill down.

        The agentic loop: the model answers with the context block, or calls a
        read-only tool; the service executes it and the result returns as a
        message, until the model answers in text or the hop cap ends the loop
        — gently, with one last call and no tools bound.

        Degrades honestly: a slow or down API makes the answer general, not
        absent, and with no data there are no tools to drill into it with.
        """
        system = self._config.system_prompt()
        tools: list = []
        target = state["target_portfolio"]
        token = state.get("authorization")
        try:
            async with step("portfolio", f"Reading portfolio · {target}"):
                portfolio = await self._portfolio.portfolio(target, token)
            system = grounded_prompt(system, portfolio, self._config.context_max_positions())
            tools = portfolio_tools(self._portfolio, target, token, portfolio)
        except Exception as error:  # noqa: BLE001 — any fetch failure degrades the same way
            logger.warning("portfolio context fetch failed for %s: %r", target, error)
            system = degraded_prompt(system)
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
        system = onboarding_prompt(self._config.system_prompt(), signed_in)
        messages = self._messages(system, state)
        async with step("think-0", "Thinking"):
            reply = await self._models.ask(
                self._config.answering(),
                messages,
                prepare=lambda model: model.bind_tools([ProposePortfolio]),
            )

        calls = getattr(reply, "tool_calls", None) or []
        if not calls:
            # No proposal yet: the conversation is still collecting addresses.
            return {"answer": extract_text(reply)}

        addresses = sanitize_addresses(calls[0].get("args", {}).get("addresses", []))
        if not addresses:
            # The model called the tool with nothing usable; ask again rather
            # than propose an empty portfolio.
            return await self._answer(system, state)

        logger.info("onboarding: proposing %d wallet(s)", len(addresses))
        confirmation = await self._answer(
            confirmation_request_prompt(self._config.system_prompt(), addresses, not signed_in),
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
            return await self._answer(creation_failed_prompt(self._config.system_prompt()), state)
        logger.info(
            "onboarding: created %s (+%d wallets, %d refused)",
            result.slug,
            len(result.added),
            len(result.refused),
        )
        answered = await self._answer(created_prompt(self._config.system_prompt(), result), state)
        outcome: AgentState = {**answered, "pending_clear": True}
        if result.slug:
            outcome["portfolio_created"] = result.slug
        return outcome

    async def _cancel_creation(self, state: AgentState) -> AgentState:
        """A declined proposal: drop it and say so — nothing was created."""
        answered = await self._answer(cancelled_prompt(self._config.system_prompt()), state)
        return {**answered, "pending_clear": True}

    async def _unavailable(self, state: AgentState) -> AgentState:
        """Identity could not be resolved: answer, and say the numbers are out of reach."""
        return await self._answer(degraded_prompt(self._config.system_prompt()), state)

    # ── shared by the nodes ─────────────────────────────────────────────────

    @staticmethod
    def _messages(system: str, state: AgentState) -> list[BaseMessage]:
        """The prompt, the conversation so far, and the question being asked."""
        messages: list[BaseMessage] = [SystemMessage(content=system)]
        for turn in state.get("history", ()):
            messages += [HumanMessage(content=turn.q), AIMessage(content=turn.a)]
        messages.append(HumanMessage(content=state["question"]))
        return messages

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
            {"portfolio": "identity", "general": "general"},
        )
        builder.add_conditional_edges(
            "identity",
            lambda state: state["route"],
            {"grounded": "grounded", "onboard": "onboard", "unavailable": "unavailable"},
        )
        for leaf in ANSWERING_NODES:
            builder.add_edge(leaf, END)
        return builder.compile()
