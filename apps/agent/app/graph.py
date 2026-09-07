"""The conversation as a graph — the routing and identity decisions of
DESIGN.md, made runnable.

The first version was a straight line — every turn fetched portfolio context
and answered.
The line became a graph the moment turns stopped being alike: a question about
DeFi in general has no business paying a portfolio fetch, and a question about
the user's money deserves one. LangGraph is the tool for exactly this shape:
nodes are steps, a typed state flows through them, and conditional edges pick
the branch. The graph itself still has no cycles; the one loop lives inside
the grounded node — the agentic tool loop — and the graph grows branches
without the route handler ever changing.

    START -> pending_gate -> [proposal waiting?]
              | no                \\-> yes+confirmed -> create_portfolio ► END
              v                   \\-> yes+declined -> cancel_creation ─► END
            classify_intent -> [intent?] -> general ───────────────────► END
                                        \\-> identity -> [?] -> grounded ► END
                                                    \\-> onboard ───────► END
                                                    \\-> unavailable ───► END

The identity node resolves WHOSE portfolio a money question is about (the
one-identity rule in DESIGN.md): the widget's slug is a hint that
short-circuits the lookup; without it, GET /auth/me answers both who the
caller is and what they own, and the conditional edge routes on the outcome.
Two failure modes are kept deliberately distinct: an EMPTY portfolio list
means onboarding, while an identity lookup ERROR means the degraded answer —
a hiccuping API must never tell a person they own nothing.

The pending gate is the write gate: creating a portfolio takes two turns by
construction — the onboarding branch can only PROPOSE (the proposal parks in
the session), and only this gate, reading a clear yes on a later turn, reaches
the one node that writes.

The classifier's failure mode is chosen, not accidental: on any error the turn
routes to the identity branch — money questions land where money is handled —
and a broken classifier degrades to yesterday's behavior, never to a worse
answer about money.
"""
import logging
from functools import cache
from typing import TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from .config import settings
from .context import (
    cancelled_prompt,
    confirmation_request_prompt,
    created_prompt,
    creation_failed_prompt,
    degraded_prompt,
    grounded_prompt,
    onboarding_prompt,
)
from .datasources import PortfolioApiSource
from .intent import classify
from .llm import extract_text, get_model
from .tools import portfolio_tools, run_tools
from .onboarding import (
    ProposePortfolio,
    classify_confirmation,
    create_portfolio_with_wallets,
    sanitize_addresses,
)

logger = logging.getLogger("svinooh-ai")
portfolio_source = PortfolioApiSource(settings.portfolio_api_url)


class AgentState(TypedDict, total=False):
    """What flows through the graph — each node reads some keys, writes others."""

    question: str
    history: list[BaseMessage]
    # The widget's hint about which portfolio is on screen, and the caller's
    # token to fetch it with — both may be absent.
    portfolio: str | None
    authorization: str | None
    # The session's proposed-but-unconfirmed action, loaded by the route layer.
    pending_addresses: list[str] | None
    # Written by classify_intent_node; the first conditional edge routes on it.
    intent: str
    # Written by identity_node: where the portfolio branch goes, and in which
    # portfolio to ground when it goes to `grounded`.
    route: str
    target_portfolio: str
    # Written by the branch that answered.
    answer: str
    # Orders back to the session store: stash this proposal / drop the current
    # one. The graph stays pure — it never touches the store itself.
    pending_set: list[str]
    pending_clear: bool


async def pending_gate(state: AgentState) -> AgentState:
    """The graph's front door once a proposal is waiting (the write gate).

    With no pending action this is a pass-through to classification. With one,
    the user's reply is read as an answer to "create it?": a clear yes goes to
    the create-portfolio node — the only node that writes — a clear no cancels,
    and anything else keeps the proposal waiting and lets the turn flow
    normally, so a question asked mid-confirmation still gets its answer.
    """
    if not state.get("pending_addresses"):
        return {"route": "classify_intent"}
    try:
        verdict = await classify_confirmation(state["question"])
    except Exception as error:  # noqa: BLE001 — an unreadable reply must not write
        logger.warning("confirmation classifier failed (%r) — keeping the proposal", error)
        return {"route": "classify_intent"}
    logger.info("confirmation: %s (%s)", verdict.decision, verdict.reason)
    if verdict.decision == "confirm":
        # A yes without a token cannot be acted on — back to onboarding, where
        # the signed-out prompt explains; the proposal stays for later.
        return {"route": "create_portfolio" if state.get("authorization") else "onboard"}
    if verdict.decision == "cancel":
        return {"route": "cancel_creation"}
    return {"route": "classify_intent"}


async def classify_intent_node(state: AgentState) -> AgentState:
    """Label the turn; on any failure, route where money questions are safe."""
    try:
        label = await classify(state["question"])
        logger.info("intent: %s (%s) q=%.80s", label.intent, label.reason, state["question"])
        return {"intent": label.intent}
    except Exception as error:  # noqa: BLE001 — the fail-safe IS the handling
        logger.warning("intent classifier failed (%r) — routing to portfolio", error)
        return {"intent": "portfolio"}


async def identity_node(state: AgentState) -> AgentState:
    """Whose portfolio is this conversation about?

    Identity is data in the state, not a guard in a handler: this node writes
    `route` and the second conditional edge acts on it. The widget's slug is a
    hint that skips the lookup; otherwise /auth/me says what the caller owns.
    """
    auth = state.get("authorization")
    if not auth:
        # Nobody to look up. The onboarding prompt carries the sign-in variant.
        logger.info("identity: no token -> onboard")
        return {"route": "onboard"}

    hint = state.get("portfolio")
    if hint:
        # The user is looking at a specific portfolio — that IS the answer.
        return {"route": "grounded", "target_portfolio": hint}

    try:
        me = await portfolio_source.me(auth)
    except Exception as error:  # noqa: BLE001 — an error is NOT an empty list
        logger.warning("identity lookup failed: %r", error)
        return {"route": "unavailable"}

    owned = me.get("portfolios") or []
    if not owned:
        logger.info("identity: owns none -> onboard")
        return {"route": "onboard"}
    # Their first portfolio stands in for "theirs" until the conversation can
    # pick between several — a refinement the state already has room for.
    target = owned[0].get("slug", "")
    logger.info("identity: owns %d -> grounded in %s", len(owned), target)
    return {"route": "grounded", "target_portfolio": target}


async def _answer(system: str, state: AgentState) -> AgentState:
    messages = [
        SystemMessage(content=system),
        *state.get("history", []),
        HumanMessage(content=state["question"]),
    ]
    reply = await get_model().ainvoke(messages)
    return {"answer": extract_text(reply)}


async def general_node(state: AgentState) -> AgentState:
    """A general question: answer directly — no portfolio fetch, by design.

    This branch is the graph's first dividend: before the router, every 'what
    is a health factor' paid a portfolio round trip it never used.
    """
    return await _answer(settings.system_prompt, state)


async def grounded_node(state: AgentState) -> AgentState:
    """Ground the answer in the target portfolio — and let the model drill down.

    This node runs the agentic loop: the model answers with the context block,
    or calls a read-only tool (history over a period it picks, position
    search); the service executes the call and the result returns as a
    message, until the model answers in text or the hop cap ends the loop.
    The cap ends it gently — one last call with no tools bound, so the turn
    ends in an answer, never in an error about loops.

    Degrades honestly, as the context fetch always has: a slow or down API
    makes the answer general, not absent — and with no data there are no
    tools, so the model cannot drill into what could not be fetched.
    """
    system = settings.system_prompt
    tools = []
    try:
        data = await portfolio_source.portfolio(state["target_portfolio"], state["authorization"])
        system = grounded_prompt(system, data)
        tools = portfolio_tools(
            portfolio_source, state["target_portfolio"], state["authorization"], data
        )
    except Exception as error:  # noqa: BLE001 — any fetch failure degrades the same way
        logger.warning(
            "portfolio context fetch failed for %s: %r", state.get("target_portfolio"), error
        )
        system = degraded_prompt(system)
    if not tools:
        return await _answer(system, state)

    messages = [
        SystemMessage(content=system),
        *state.get("history", []),
        HumanMessage(content=state["question"]),
    ]
    model = get_model().bind_tools(tools)
    for _ in range(settings.tool_hops):
        reply = await model.ainvoke(messages)
        calls = getattr(reply, "tool_calls", None) or []
        if not calls:
            return {"answer": extract_text(reply)}
        messages.append(reply)
        messages.extend(await run_tools(calls, tools))
    final = await get_model().ainvoke(messages)
    return {"answer": extract_text(final)}


async def onboard_node(state: AgentState) -> AgentState:
    """A portfolio question with no portfolio behind it: onboard in the chat.

    The model converses with the ProposePortfolio tool bound. Its docstring and
    schema ARE the instructions the model sees — the promised payoff of writing
    docstrings for the machine. A tool call here does not create anything: it
    becomes the session's pending action plus a confirmation question, and the
    write waits for the gate on a later turn.
    """
    signed_in = bool(state.get("authorization"))
    system = onboarding_prompt(settings.system_prompt, signed_in)
    if not signed_in:
        return await _answer(system, state)

    messages = [
        SystemMessage(content=system),
        *state.get("history", []),
        HumanMessage(content=state["question"]),
    ]
    reply = await get_model().bind_tools([ProposePortfolio]).ainvoke(messages)

    calls = getattr(reply, "tool_calls", None) or []
    if not calls:
        # No proposal yet — this is the conversation still collecting addresses.
        return {"answer": extract_text(reply)}

    addresses = sanitize_addresses(calls[0].get("args", {}).get("addresses", []))
    if not addresses:
        # The model called the tool with nothing usable; ask again rather than
        # propose an empty portfolio.
        return await _answer(system, state)

    logger.info("onboarding: proposing %d wallet(s)", len(addresses))
    confirmation = await _answer(
        confirmation_request_prompt(settings.system_prompt, addresses), state
    )
    return {**confirmation, "pending_set": addresses}


async def create_portfolio_node(state: AgentState) -> AgentState:
    """The one node that writes — reachable only through a confirmed gate.

    The portfolio create failing keeps the proposal (a later yes retries); a
    single wallet failing does not sink the rest, and the answer relays the
    partial result honestly.
    """
    addresses = state.get("pending_addresses") or []
    try:
        result = await create_portfolio_with_wallets(
            portfolio_source, addresses, state["authorization"]
        )
    except Exception as error:  # noqa: BLE001 — nothing was created; say so
        logger.warning("portfolio creation failed: %r", error)
        return await _answer(creation_failed_prompt(settings.system_prompt), state)
    logger.info(
        "onboarding: created %s (+%d wallets, %d refused)",
        result.get("slug"), len(result.get("added", [])), len(result.get("failed", [])),
    )
    answered = await _answer(created_prompt(settings.system_prompt, result), state)
    return {**answered, "pending_clear": True}


async def cancel_creation_node(state: AgentState) -> AgentState:
    """A declined proposal: drop it and say so — nothing was created."""
    answered = await _answer(cancelled_prompt(settings.system_prompt), state)
    return {**answered, "pending_clear": True}


async def unavailable_node(state: AgentState) -> AgentState:
    """Identity could not be resolved: answer, and say the numbers are out of reach."""
    return await _answer(degraded_prompt(settings.system_prompt), state)


@cache  # built and compiled once per process, like the model clients
def agent_graph():
    builder = StateGraph(AgentState)
    # Node names carry the domain, not the mechanism: "create_portfolio", never
    # "execute" — a mechanism name stops meaning anything once the graph has
    # many branches. Registration order is irrelevant; the edges below are the
    # topology, and compile() checks that every referenced name exists.
    builder.add_node("pending_gate", pending_gate)
    builder.add_node("classify_intent", classify_intent_node)
    builder.add_node("identity", identity_node)
    builder.add_node("general", general_node)
    builder.add_node("grounded", grounded_node)
    builder.add_node("onboard", onboard_node)
    builder.add_node("create_portfolio", create_portfolio_node)
    builder.add_node("cancel_creation", cancel_creation_node)
    builder.add_node("unavailable", unavailable_node)

    builder.add_edge(START, "pending_gate")
    # Each conditional edge is a router: it reads what the previous node wrote
    # and names the next one. The mappings are explicit so a value nobody wired
    # fails loudly here instead of wandering the graph.
    builder.add_conditional_edges(
        "pending_gate",
        lambda state: state["route"],
        {
            "classify_intent": "classify_intent",
            "create_portfolio": "create_portfolio",
            "cancel_creation": "cancel_creation",
            "onboard": "onboard",
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
    for leaf in ("general", "grounded", "onboard", "create_portfolio", "cancel_creation", "unavailable"):
        builder.add_edge(leaf, END)
    return builder.compile()
