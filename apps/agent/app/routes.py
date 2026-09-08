"""The HTTP surface: /health for the platform, /chat for everyone else.

Thin on purpose: this layer validates the request, hands a state to
the graph, and stores the finished turn. What happens between — routing,
context, the model — is the graph's business (app/graph.py), which is why new
branches land there without this file changing again.

Two ways to ask the same question. /chat answers when the answer is finished;
/chat/stream reports it as it is written. They share everything that decides
what a turn IS — who is asking, whether they may, what the session remembers —
because a door that only one of them checks is a door.
"""
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from . import remote_config
from .auth import authenticate
from .config import settings
from .graph import agent_graph
from .limits import RateLimiter
from .schemas import ChatRequest, ChatResponse, TextBlock
from .sessions import SessionStore
from .streaming import turn_events

router = APIRouter()
sessions = SessionStore(settings.history_max_messages, settings.history_ttl_s)
limiter = RateLimiter(settings.rate_limit_requests, settings.rate_limit_window_s)


@router.get("/health")
def health() -> dict:
    return {"ok": True}


async def _admit(body: ChatRequest, authorization: str | None) -> tuple[str, str, dict]:
    """Check the caller in, and build the state one turn runs on.

    Everything here refuses before any work is done, so a refusal is a status
    code rather than a stream that opens and immediately apologises.
    """
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
    state = {
        "question": text,
        "history": sessions.history(session_id),
        "portfolio": body.portfolio,
        "authorization": authorization,
        "pending_addresses": sessions.pending(session_id),
    }
    return text, session_id, state


def _remember(session_id: str, question: str, state: dict) -> str:
    """Apply the graph's orders to the store, then remember the turn.

    Only after the graph answered, so a failed turn leaves the session exactly
    as it was, instead of a question with no answer in it.
    """
    answer = state["answer"]
    if state.get("pending_set"):
        sessions.set_pending(session_id, state["pending_set"])
    if state.get("pending_clear"):
        sessions.clear_pending(session_id)
    sessions.append(session_id, question, answer)
    return answer


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    authorization: str | None = Header(default=None),
) -> ChatResponse:
    question, session_id, state = await _admit(body, authorization)
    answer = _remember(session_id, question, await agent_graph().ainvoke(state))
    return ChatResponse(blocks=[TextBlock(text=answer)], reply=answer, session_id=session_id)


def _event(name: str, data: dict) -> str:
    """One server-sent event.

    ensure_ascii is off because these answers are frequently not ascii and a
    reader watching \\u0440\\u0438 arrive is not watching their answer arrive.
    JSON is what keeps a newline inside an answer from ending the event.
    """
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """The same turn, reported while it happens.

    `start` goes out before any model is called, which is what lets a chat show
    it heard the question rather than guessing from a timer. `step` is the work
    reporting itself as it happens — every line is an operation that ran, said
    by the code that ran it (app/steps.py). `done` carries the finished answer — the very body /chat would have returned, schema stamp
    included — and is what a client should render: the tokens before it are a
    preview of the work, and a branch that answers from a fixed sentence
    produces no tokens at all.

    One wire, two deliveries. A client that can read /chat can read the end of
    this, which is what keeps a second endpoint from becoming a second
    contract to keep in step.
    """
    question, session_id, state = await _admit(body, authorization)

    async def events() -> AsyncIterator[str]:
        yield _event("start", {"session_id": session_id})
        async for name, data in turn_events(state):
            if name != "done":
                yield _event(name, data)
                continue
            answer = _remember(session_id, question, data)
            finished = ChatResponse(
                blocks=[TextBlock(text=answer)], reply=answer, session_id=session_id
            )
            yield _event("done", finished.model_dump(by_alias=True))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Without this a reverse proxy is free to hold the whole stream and
            # hand it over at the end, which is the thing we are fixing.
            "X-Accel-Buffering": "no",
        },
    )
