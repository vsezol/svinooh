"""The HTTP surface: /health for the platform, /chat for everyone else.

Thin on purpose: this layer validates the request, hands a state to
the graph, and stores the finished turn. What happens between — routing,
context, the model — is the graph's business (app/graph.py), which is why new
branches land there without this file changing again.
"""
from fastapi import APIRouter, Header, HTTPException

from . import remote_config
from .auth import authenticate
from .config import settings
from .graph import agent_graph
from .limits import RateLimiter
from .schemas import ChatRequest, ChatResponse, TextBlock
from .sessions import SessionStore

router = APIRouter()
sessions = SessionStore(settings.history_max_messages, settings.history_ttl_s)
limiter = RateLimiter(settings.rate_limit_requests, settings.rate_limit_window_s)


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    authorization: str | None = Header(default=None),
) -> ChatResponse:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")

    # Never awaited: a person waiting for an answer must not also wait for a
    # settings poll. This turn runs on what is already in hand.
    remote_config.refresh_soon()

    # The lock on the door: name the caller (401 only when the host rejects
    # the token outright), then charge the turn against their budget. The
    # anonymous share one budget — enough to try the product, not to spend on
    # someone else's meter.
    caller = await authenticate(authorization)
    retry_after = await limiter.retry_after(f"user:{caller.user_id}" if caller else "anonymous")
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="rate limited — try again shortly",
            headers={"Retry-After": str(retry_after)},
        )

    # The session's history and its pending proposal ride into the graph, which
    # is what makes "as we discussed" — and "yes, create it" — work across
    # requests; the graph decides everything else and never touches the store.
    session_id = body.session_id or sessions.new_id()
    state = await agent_graph().ainvoke(
        {
            "question": text,
            "history": sessions.history(session_id),
            "portfolio": body.portfolio,
            "authorization": authorization,
            "pending_addresses": sessions.pending(session_id),
        }
    )
    answer = state["answer"]

    # Apply the graph's orders to the store, then remember the turn — only
    # after the graph answered, so a failed turn leaves the session exactly as
    # it was, instead of a question with no answer in it.
    if state.get("pending_set"):
        sessions.set_pending(session_id, state["pending_set"])
    if state.get("pending_clear"):
        sessions.clear_pending(session_id)
    sessions.append(session_id, text, answer)
    return ChatResponse(blocks=[TextBlock(text=answer)], reply=answer, session_id=session_id)
