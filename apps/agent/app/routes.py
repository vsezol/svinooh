"""The HTTP surface: /health for the platform, /chat for everyone else."""
import asyncio
import logging

from fastapi import APIRouter, Header, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage

from .config import settings
from .context import portfolio_context
from .datasources import PortfolioApiSource
from .intent import classify_shadow
from .llm import extract_text, get_model
from .schemas import ChatRequest, ChatResponse
from .sessions import SessionStore

logger = logging.getLogger("svinooh-ai")
router = APIRouter()
sessions = SessionStore(settings.history_max_messages, settings.history_ttl_s)
portfolio_source = PortfolioApiSource(settings.portfolio_api_url)

# Fire-and-forget background work (the shadow classifier). The set keeps a
# strong reference until each task finishes — asyncio only holds tasks weakly,
# and an unreferenced task can be garbage-collected mid-flight.
_background: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


@router.get("/health")
def health() -> dict:
    return {"ok": True}


async def _system_prompt(portfolio: str | None, authorization: str | None) -> str:
    """The base prompt, grounded in the portfolio on screen when it can be.

    Degrades honestly rather than failing the turn: the portfolio API being
    slow or down makes the answer general, not absent — and the prompt says the
    live numbers are unavailable, so the model does not guess them.
    """
    if not portfolio or not authorization:
        return settings.system_prompt
    try:
        data = await portfolio_source.portfolio(portfolio, authorization)
        return f"{settings.system_prompt}\n\nThe user is looking at this portfolio right now:\n{portfolio_context(data)}"
    except Exception as error:  # noqa: BLE001 — any fetch failure degrades the same way
        logger.warning("portfolio context fetch failed for %s: %r", portfolio, error)
        return (
            f"{settings.system_prompt}\n\n(Live portfolio data could not be fetched "
            "for this turn — answer generally, and say the live numbers are "
            "unavailable if asked about them.)"
        )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    authorization: str | None = Header(default=None),
) -> ChatResponse:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")

    # One call per turn, but not one turn of context: the session's history
    # rides along, which is what makes "as we discussed" work across requests.
    # The portfolio context is NOT stored in the session — it is refetched each
    # turn, because balances move and a remembered number is a wrong number.
    session_id = body.session_id or sessions.new_id()

    # Shadow routing (R1, DESIGN.md D7): label the turn in the background and
    # log the label. Never awaited on the request path, so it cannot add
    # latency or failure — the answer below is computed exactly as before.
    _spawn(classify_shadow(text, session_id))

    messages = [
        SystemMessage(content=await _system_prompt(body.portfolio, authorization)),
        *sessions.history(session_id),
        HumanMessage(content=text),
    ]
    reply = await get_model().ainvoke(messages)
    answer = extract_text(reply)

    # Remembered only after the model answered: a failed call leaves the
    # session exactly as it was, instead of a question with no answer in it.
    sessions.append(session_id, text, answer)
    return ChatResponse(reply=answer, session_id=session_id)
