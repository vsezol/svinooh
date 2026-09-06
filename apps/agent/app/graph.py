"""The conversation as a graph (R2, DESIGN.md D7).

v1 was a straight line — every turn fetched portfolio context and answered.
The line became a graph the moment turns stopped being alike: a question about
DeFi in general has no business paying a portfolio fetch, and a question about
the user's money deserves one. LangGraph is the tool for exactly this shape:
nodes are steps, a typed state flows through them, and a conditional edge picks
the branch. Nothing here loops yet; the graph grows branches (R3 identity,
R4 onboarding) without the route handler ever changing again.

    START -> classify -> [intent?] -> portfolio -> END
                                  \\-> general  -> END

The classifier's failure mode is chosen, not accidental: on any error the turn
routes to `portfolio` — the branch that behaves exactly like pre-R2 code — so a
broken classifier degrades to yesterday's behavior, never to a worse answer
about money.
"""
import logging
from functools import cache
from typing import TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from .config import settings
from .context import degraded_prompt, grounded_prompt
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
    # Written by classify_node; the conditional edge routes on it.
    intent: str
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

    This branch is the graph's first dividend: before R2, every 'what is a
    health factor' paid a portfolio round trip it never used.
    """
    return await _answer(settings.system_prompt, state)


async def portfolio_node(state: AgentState) -> AgentState:
    """A question about the user's money: ground the answer in their portfolio.

    Degrades honestly, same as M1: the portfolio API being slow or down makes
    the answer general, not absent — and the prompt says the live numbers are
    unavailable, so the model does not guess them.
    """
    system = settings.system_prompt
    slug, auth = state.get("portfolio"), state.get("authorization")
    if slug and auth:
        try:
            system = grounded_prompt(system, await portfolio_source.portfolio(slug, auth))
        except Exception as error:  # noqa: BLE001 — any fetch failure degrades the same way
            logger.warning("portfolio context fetch failed for %s: %r", slug, error)
            system = degraded_prompt(system)
    return await _answer(system, state)


@cache  # built and compiled once per process, like the model clients
def agent_graph():
    builder = StateGraph(AgentState)
    builder.add_node("classify", classify_node)
    builder.add_node("general", general_node)
    builder.add_node("portfolio", portfolio_node)
    builder.add_edge(START, "classify")
    # The conditional edge is the router: it reads what classify_node wrote and
    # names the next node. The mapping is explicit so a new intent value that
    # nobody wired fails loudly here instead of wandering the graph.
    builder.add_conditional_edges(
        "classify",
        lambda state: state["intent"],
        {"portfolio": "portfolio", "general": "general"},
    )
    builder.add_edge("general", END)
    builder.add_edge("portfolio", END)
    return builder.compile()
