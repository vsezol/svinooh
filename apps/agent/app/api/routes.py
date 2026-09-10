"""The HTTP surface: /health for the platform, /chat and /chats for everyone else.

Thin on purpose: this layer validates the request, hands a state to the
agent, and stores the finished turn. What happens between — routing, context,
the model — is the graph's business, which is why new branches land there
without this file changing.

Two ways to ask the same question. /chat answers when the answer is finished;
/chat/stream reports it as it is written. They share everything that decides
what a turn IS — who is asking, whether they may, what the session remembers
— because a door that only one of them checks is a door.

Every handler takes the container through `Depends`: what it needs arrives
with the request, and a test hands the app a container of its own.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..agent.graph import AgentState
from ..container import Container
from ..domain.conversation import Chat
from ..domain.identity import ANON_HEADER, Owner
from .schemas import (
    ChatDetail,
    ChatList,
    ChatRequest,
    ChatResponse,
    ChatSummary,
    ChatTurn,
    SignInBlock,
    TextBlock,
)

logger = logging.getLogger("svinooh-ai")

router = APIRouter()


def _container(request: Request) -> Container:
    return request.app.state.container


Deps = Annotated[Container, Depends(_container)]
Authorization = Annotated[str | None, Header()]
AnonId = Annotated[str | None, Header(alias=ANON_HEADER)]


@router.get("/health")
def health() -> dict:
    return {"ok": True}


def _budget(owner: Owner | None) -> str:
    """Whose meter this turn is charged to.

    Deliberately NOT the owner key. Storage keys on the browser's anonymous id
    because that is what history hangs on; a rate limit cannot, because that
    id is soft — a private window mints a new one, so a per-id budget is a
    budget anybody can refill. The anonymous share one bucket: enough to try
    the product, not enough to spend on somebody else's meter.
    """
    return f"user:{owner.user_id}" if owner and owner.signed_in else "anonymous"


async def _claim_anonymous_chats(deps: Container, owner: Owner | None) -> None:
    """Move a visitor's conversations onto the account they just signed into.

    Lazy and self-limiting rather than an endpoint the client must remember
    to call: one EXISTS on an authenticated request, and once the move is
    done the anonymous index is gone, so every later check is a miss.
    """
    if owner is None or not owner.signed_in:
        return
    source = owner.anonymous_key
    if source is None:
        return
    if await deps.sessions.owns_any(source):
        await deps.sessions.reassign(source, owner.key)


async def _admit(
    deps: Container, body: ChatRequest, authorization: str | None, anon_id: str | None
) -> tuple[str, str, Owner, AgentState]:
    """Check the caller in, and build the state one turn runs on.

    Everything here refuses before any work is done, so a refusal is a status
    code rather than a stream that opens and immediately apologises.
    """
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")

    # The lock on the door: name the caller (401 only when the host rejects
    # the token outright), then charge the turn against their budget.
    identity = await deps.identity.resolve(authorization, anon_id)
    retry_after = await deps.limiter.retry_after(_budget(identity))
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="rate limited — try again shortly",
            headers={"Retry-After": str(retry_after)},
        )

    await _claim_anonymous_chats(deps, identity)

    # A caller's own live conversation is continued; anything else — no id, an
    # expired one, somebody else's — quietly becomes a new conversation under
    # a new id, which is what keeps a guessable id from being a way in.
    session_id, chat, owner = await deps.sessions.open_turn(body.session_id, identity)

    # The history and the pending proposal ride into the graph, which is what
    # makes "as we discussed" and "yes, create it" work across requests; the
    # graph decides everything else and never touches the store.
    state: AgentState = {
        "question": text,
        "history": deps.sessions.context(chat),
        # The widget's hint wins — it is what is on screen. Behind it, the
        # portfolio this conversation created, so a visitor who has one is
        # grounded in it rather than onboarded a second time.
        "portfolio": body.portfolio or (chat.portfolio if chat else None),
        "authorization": authorization,
        "pending_addresses": list(chat.pending) if chat and chat.pending else None,
    }
    return text, session_id, owner, state


async def _remember(
    deps: Container, session_id: str, owner: Owner, question: str, state: dict
) -> str:
    """Apply the graph's orders to the store, then remember the turn.

    Only after the graph answered, so a failed turn leaves the session exactly
    as it was, instead of a question with no answer in it.
    """
    answer = state["answer"]
    if state.get("pending_set"):
        await deps.sessions.set_pending(session_id, owner.key, state["pending_set"])
    if state.get("pending_clear"):
        await deps.sessions.clear_pending(session_id)
    if state.get("portfolio_created"):
        await deps.sessions.set_portfolio(session_id, owner.key, state["portfolio_created"])
    # The blocks are stored with the turn, so reopening the conversation shows
    # what was on screen rather than a reconstruction of it.
    await deps.sessions.append(
        session_id, owner.key, question, answer, [TextBlock(text=answer).model_dump()]
    )
    return answer


async def _sign_in_wall(deps: Container, owner: Owner, question: str) -> SignInBlock | None:
    """The free allowance, and what replaces an answer once it is spent.

    Not a refusal: a 200 carrying a different block, because the person did
    nothing wrong and there is something for them to do. An account never
    meets this — the allowance says where one starts.
    """
    if owner.signed_in:
        return None
    if await deps.allowance.charge(owner.key):
        return None
    logger.info("allowance spent for %s — the answer is the sign-in card", owner.key)
    return SignInBlock(
        title="Sign in to keep asking",
        sub=(
            "That is the free questions used up. An account continues this "
            "conversation — and claims a portfolio made here, which until then "
            "belongs to nobody."
        ),
        # The question travels with the card so the widget can ask it again
        # itself once the auth flow returns. They typed it and got a door.
        pending_question=question,
    )


async def _remember_wall(
    deps: Container, session_id: str, owner: Owner, question: str, wall: SignInBlock
) -> None:
    """Record the turn where the answer was a door.

    It happened, so a conversation reopened later shows what was on screen.
    And the client takes this turn's id for the conversation's address: a
    turn that stored nothing would leave /ai/c/<id> pointing at a 404.
    """
    await deps.sessions.append(
        session_id, owner.key, question, wall.sub, [wall.model_dump(by_alias=True)]
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> ChatResponse:
    question, session_id, owner, state = await _admit(deps, body, authorization, anon_id)
    wall = await _sign_in_wall(deps, owner, question)
    if wall is not None:
        await _remember_wall(deps, session_id, owner, question, wall)
        return ChatResponse(blocks=[wall], reply=wall.sub, session_id=session_id)
    answer = await _remember(deps, session_id, owner, question, await deps.agent.run(state))
    return ChatResponse(blocks=[TextBlock(text=answer)], reply=answer, session_id=session_id)


def _event(name: str, data: dict) -> str:
    """One server-sent event; JSON keeps a newline inside an answer from ending it."""
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> StreamingResponse:
    """The same turn, reported while it happens.

    `start` goes out before any model is called and carries the conversation's
    id, so the chat has an address from its first turn. `step` is the work
    reporting itself (app/agent/steps.py). `done` carries the finished answer
    — the very body /chat would have returned — and is what a client renders:
    the tokens before it are a preview. One wire, two deliveries.
    """
    question, session_id, owner, state = await _admit(deps, body, authorization, anon_id)
    # Charged before the stream opens, like every other admission decision, so
    # the allowance cannot be spent twice by a client that never reads the body.
    wall = await _sign_in_wall(deps, owner, question)

    async def events() -> AsyncIterator[str]:
        yield _event("start", {"session_id": session_id})
        if wall is not None:
            # No steps and no tokens: nothing ran. The card is the whole turn.
            await _remember_wall(deps, session_id, owner, question, wall)
            walled = ChatResponse(blocks=[wall], reply=wall.sub, session_id=session_id)
            yield _event("done", walled.model_dump(by_alias=True))
            return
        async for name, data in deps.agent.watch(state):
            if name != "done":
                yield _event(name, data)
                continue
            answer = await _remember(deps, session_id, owner, question, data)
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


# ── the conversations, read rather than continued ───────────────────────────


async def _reader(deps: Container, authorization: str | None, anon_id: str | None) -> Owner | None:
    """Who is asking, for a read.

    The re-key runs here as well as on a turn, and it has to: somebody signs
    in from the card under their first answer and the rail asks for their
    list immediately, before there is a next question to carry the move.
    """
    owner = await deps.identity.resolve(authorization, anon_id)
    await _claim_anonymous_chats(deps, owner)
    return owner


def _summaries(chats: list[Chat]) -> list[ChatSummary]:
    return [ChatSummary(id=c.id, title=c.title or "New chat", at=c.updated) for c in chats]


@router.get("/chats", response_model=ChatList)
async def list_chats(
    deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> ChatList:
    """This caller's conversations, newest first; empty for a caller with no identity."""
    owner = await _reader(deps, authorization, anon_id)
    if owner is None:
        return ChatList(chats=[])
    listed = await deps.sessions.list(owner.key, deps.settings.chat_list_limit)
    return ChatList(chats=_summaries(listed))


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def read_chat(
    chat_id: str, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> ChatDetail:
    """One conversation, if it belongs to whoever is asking.

    Somebody else's is a 404 rather than a 403: a 403 confirms it exists, and
    a chat names positions and amounts — nothing identifying somebody reaches
    anybody else, and that covers the fact of them having asked at all.
    """
    owner = await _reader(deps, authorization, anon_id)
    chat = await deps.sessions.chat(chat_id, owner.key) if owner else None
    if chat is None:
        raise HTTPException(status_code=404, detail="no such conversation")
    return ChatDetail(
        id=chat.id,
        title=chat.title or "New chat",
        at=chat.updated,
        turns=[ChatTurn(q=t.q, a=t.a, at=t.at, blocks=t.blocks) for t in chat.turns],
    )


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: str, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> None:
    owner = await _reader(deps, authorization, anon_id)
    if owner is None or not await deps.sessions.delete(chat_id, owner.key):
        raise HTTPException(status_code=404, detail="no such conversation")
