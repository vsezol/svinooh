"""The conversation as a graph (DESIGN.md D6/D7).

The first version was a straight line — every turn fetched portfolio context
and answered.
The line became a graph the moment turns stopped being alike: a question about
DeFi in general has no business paying a portfolio fetch, and a question about
the user's money deserves one. LangGraph is the tool for exactly this shape:
nodes are steps, a typed state flows through them, and conditional edges pick
the branch. Nothing here loops yet; the graph grows branches without the route
handler ever changing.

    START -> classify -> [intent?] -> general ─────────────────────────► END
                                  \\-> identity -> [route?] -> grounded ─► END
                                                          \\-> onboard ──► END
                                                          \\-> unavailable ► END

The identity node is the newest branch: a portfolio question first resolves WHOSE
portfolio (D6). The widget's slug is a hint that short-circuits the lookup;
without it, GET /auth/me answers both who the caller is and what they own, and
the second conditional edge routes on the outcome. Two failure modes are kept
deliberately distinct: an EMPTY portfolio list means onboarding, while an
identity lookup ERROR means the degraded answer — a hiccuping API must never
tell a person they own nothing.

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
from .context import degraded_prompt, grounded_prompt, onboarding_prompt
from .datasources import PortfolioApiSource
from .intent import classify
from .llm import extract_text, get_model

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
    # Written by classify_node; the first conditional edge routes on it.
    intent: str
    # Written by identity_node: where the portfolio branch goes, and in which
    # portfolio to ground when it goes to `grounded`.
    route: str
    target_portfolio: str
    # Written by the branch that answered.
    answer: str


async def classify_node(state: AgentState) -> AgentState:
    """Label the turn; on any failure, route where money questions are safe."""
    try:
        label = await classify(state["question"])
        logger.info("intent: %s (%s) q=%.80s", label.intent, label.reason, state["question"])
        return {"intent": label.intent}
    except Exception as error:  # noqa: BLE001 — the fail-safe IS the handling
        logger.warning("intent classifier failed (%r) — routing to portfolio", error)
        return {"intent": "portfolio"}


async def identity_node(state: AgentState) -> AgentState:
    """Whose portfolio is this conversation about? (DESIGN.md D6)

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
    """Ground the answer in the target portfolio identity resolved.

    Degrades honestly, as the context fetch always has: a slow or down API makes
    the answer general, not absent — and the prompt says the live numbers are
    unavailable, so the model does not guess them.
    """
    system = settings.system_prompt
    try:
        data = await portfolio_source.portfolio(state["target_portfolio"], state["authorization"])
        system = grounded_prompt(system, data)
    except Exception as error:  # noqa: BLE001 — any fetch failure degrades the same way
        logger.warning(
            "portfolio context fetch failed for %s: %r", state.get("target_portfolio"), error
        )
        system = degraded_prompt(system)
    return await _answer(system, state)


async def onboard_node(state: AgentState) -> AgentState:
    """A portfolio question with no portfolio behind it.

    A stub until conversational onboarding (DESIGN.md D8) fills it.
    """
    signed_in = bool(state.get("authorization"))
    return await _answer(onboarding_prompt(settings.system_prompt, signed_in), state)


async def unavailable_node(state: AgentState) -> AgentState:
    """Identity could not be resolved: answer, and say the numbers are out of reach."""
    return await _answer(degraded_prompt(settings.system_prompt), state)


@cache  # built and compiled once per process, like the model clients
def agent_graph():
    builder = StateGraph(AgentState)
    builder.add_node("classify", classify_node)
    builder.add_node("identity", identity_node)
    builder.add_node("general", general_node)
    builder.add_node("grounded", grounded_node)
    builder.add_node("onboard", onboard_node)
    builder.add_node("unavailable", unavailable_node)

    builder.add_edge(START, "classify")
    # Each conditional edge is a router: it reads what the previous node wrote
    # and names the next one. The mappings are explicit so a value nobody wired
    # fails loudly here instead of wandering the graph.
    builder.add_conditional_edges(
        "classify",
        lambda state: state["intent"],
        {"portfolio": "identity", "general": "general"},
    )
    builder.add_conditional_edges(
        "identity",
        lambda state: state["route"],
        {"grounded": "grounded", "onboard": "onboard", "unavailable": "unavailable"},
    )
    for leaf in ("general", "grounded", "onboard", "unavailable"):
        builder.add_edge(leaf, END)
    return builder.compile()
