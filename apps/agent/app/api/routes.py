"""The HTTP surface: /health for the platform, /chat and /chats for everyone else.

Thin on purpose: this layer validates the request, hands a state to
the graph, and stores the finished turn. What happens between — routing,
context, the model — is the graph's business (app/graph.py), which is why new
branches land there without this file changing again.

Two ways to ask the same question. /chat answers when the answer is finished;
/chat/stream reports it as it is written. They share everything that decides
what a turn IS — who is asking, whether they may, what the session remembers —
because a door that only one of them checks is a door.

/chats is the same conversations, read rather than continued. It exists because
the store became durable (app/store.py): a conversation is a server object now,
so it has an address, and reading one is authorized to whoever it belongs to.
"""

import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from ..agent.graph import agent_graph
from ..agent.streaming import turn_events
from ..composition import allowance, limiter, sessions
from ..domain.conversation import Chat
from ..domain.identity import ANON_HEADER, Owner
from ..services.identity import resolve_owner
from ..settings import settings
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


@router.get("/health")
def health() -> dict:
    return {"ok": True}


def _budget(owner: Owner | None) -> str:
    """Whose meter this turn is charged to.

    Deliberately NOT the owner key. Storage keys on the browser's anonymous id
    because that is what history hangs on; a rate limit cannot, because that id
    is soft — clearing storage mints a new one, so a per-id budget is a budget
    anybody can refill by opening a private window. So the anonymous keep
    sharing the single bucket they have always shared: enough to try the
    product, not enough to spend on somebody else's meter. Making that
    per-visitor is step 3 part 5's problem, and it needs something harder than
    this id to be worth doing.
    """
    return f"user:{owner.user_id}" if owner and owner.signed_in else "anonymous"


async def _claim_anonymous_chats(owner: Owner | None) -> None:
    """Move a visitor's conversations onto the account they just signed into.

    Lazy and self-limiting rather than an endpoint the client has to remember
    to call: one EXISTS on an authenticated turn, and once the move is done the
    anonymous index is gone, so every later turn's check is a miss. A client
    that never announces its sign-in still ends up with its history, which
    matters because the product asks somebody to sign in underneath their first
    answer — the exact moment the conversation became worth keeping.
    """
    if owner is None or not owner.signed_in:
        return
    source = owner.anonymous_key
    if source is None:
        return
    if await sessions.owns_any(source):
        await sessions.reassign(source, owner.key)


async def _admit(
    body: ChatRequest, authorization: str | None, anon_id: str | None
) -> tuple[str, str, Owner, dict]:
    """Check the caller in, and build the state one turn runs on.

    Everything here refuses before any work is done, so a refusal is a status
    code rather than a stream that opens and immediately apologises.
    """
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")

    # The lock on the door: name the caller (401 only when the host rejects
    # the token outright), then charge the turn against their budget.
    identity = await resolve_owner(authorization, anon_id)
    retry_after = await limiter.retry_after(_budget(identity))
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="rate limited — try again shortly",
            headers={"Retry-After": str(retry_after)},
        )

    await _claim_anonymous_chats(identity)

    # Which conversation this turn runs in, what to call it, and whose it is.
    # A caller's own live conversation is continued; anything else — no id, an
    # expired one, somebody else's — quietly becomes a new conversation under a
    # new id. That is what keeps a guessable id from being a way to read,
    # extend, or even detect a conversation that is not yours. See open_turn.
    session_id, chat, owner = await sessions.open_turn(body.session_id, identity)

    # The session's history and its pending proposal ride into the graph, which
    # is what makes "as we discussed" — and "yes, create it" — work across
    # requests; the graph decides everything else and never touches the store.
    # Both are read off the one conversation the line above loaded.
    state = {
        "question": text,
        "history": sessions.context(chat),
        # The widget's hint wins — it is what is on screen right now. Behind it,
        # the portfolio this conversation created, so a visitor who has one is
        # grounded in it rather than onboarded a second time.
        "portfolio": body.portfolio or (chat.portfolio if chat else None),
        "authorization": authorization,
        "pending_addresses": list(chat.pending) if chat and chat.pending else None,
    }
    return text, session_id, owner, state


async def _remember(session_id: str, owner: Owner, question: str, state: dict) -> str:
    """Apply the graph's orders to the store, then remember the turn.

    Only after the graph answered, so a failed turn leaves the session exactly
    as it was, instead of a question with no answer in it.
    """
    answer = state["answer"]
    if state.get("pending_set"):
        await sessions.set_pending(session_id, owner.key, state["pending_set"])
    if state.get("pending_clear"):
        await sessions.clear_pending(session_id)
    if state.get("portfolio_created"):
        await sessions.set_portfolio(session_id, owner.key, state["portfolio_created"])
    # The blocks are stored with the turn, so reopening the conversation shows
    # what was on screen rather than a reconstruction of it.
    await sessions.append(
        session_id, owner.key, question, answer, [TextBlock(text=answer).model_dump()]
    )
    return answer


async def _sign_in_wall(owner: Owner, question: str) -> SignInBlock | None:
    """The free allowance, and what replaces an answer once it is spent.

    Not a refusal: it is a 200 carrying a different block, because the person
    did nothing wrong and there is something for them to do. It rides the same
    wire as an answer for the same reason every widget does — a new block kind
    rather than a new status code or a new endpoint.

    An account never meets this. The allowance exists to say where one starts,
    so charging somebody who already has one would be charging them for the
    thing they already did.
    """
    if owner.signed_in:
        return None
    if await allowance.charge(owner.key):
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


async def _remember_wall(session_id: str, owner: Owner, question: str, wall: SignInBlock) -> None:
    """Record the turn where the answer was a door.

    Recorded rather than skipped for two reasons. It happened — the question
    was asked and the card is what came back, so a conversation reopened later
    shows what was on screen, exactly as any other turn does. And the client
    takes this turn's id for the conversation's address: a turn that stored
    nothing would leave `/ai/c/<id>` pointing at a conversation the server has
    never heard of, which reads as somebody else's 404.
    """
    await sessions.append(
        session_id, owner.key, question, wall.sub, [wall.model_dump(by_alias=True)]
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    authorization: str | None = Header(default=None),
    anon_id: str | None = Header(default=None, alias=ANON_HEADER),
) -> ChatResponse:
    question, session_id, owner, state = await _admit(body, authorization, anon_id)
    wall = await _sign_in_wall(owner, question)
    if wall is not None:
        await _remember_wall(session_id, owner, question, wall)
        return ChatResponse(blocks=[wall], reply=wall.sub, session_id=session_id)
    answer = await _remember(session_id, owner, question, await agent_graph().ainvoke(state))
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
    anon_id: str | None = Header(default=None, alias=ANON_HEADER),
) -> StreamingResponse:
    """The same turn, reported while it happens.

    `start` goes out before any model is called, which is what lets a chat show
    it heard the question rather than guessing from a timer — and it carries
    the conversation's id, which is what lets the chat have an address from its
    first turn rather than once its first answer has finished. `step` is the
    work reporting itself as it happens — every line is an operation that ran,
    said by the code that ran it (app/steps.py). `done` carries the finished
    answer — the very body /chat would have returned, schema stamp included —
    and is what a client should render: the tokens before it are a preview of
    the work, and a branch that answers from a fixed sentence produces no
    tokens at all.

    One wire, two deliveries. A client that can read /chat can read the end of
    this, which is what keeps a second endpoint from becoming a second
    contract to keep in step.
    """
    question, session_id, owner, state = await _admit(body, authorization, anon_id)
    # Charged before the stream opens, like every other admission decision, so
    # the allowance cannot be spent twice by a client that never reads the body.
    wall = await _sign_in_wall(owner, question)

    async def events() -> AsyncIterator[str]:
        yield _event("start", {"session_id": session_id})
        if wall is not None:
            # No steps and no tokens: nothing ran. The card is the whole turn,
            # delivered in the one event a client is told to render.
            await _remember_wall(session_id, owner, question, wall)
            walled = ChatResponse(blocks=[wall], reply=wall.sub, session_id=session_id)
            yield _event("done", walled.model_dump(by_alias=True))
            return
        async for name, data in turn_events(state):
            if name != "done":
                yield _event(name, data)
                continue
            answer = await _remember(session_id, owner, question, data)
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


async def _reader(authorization: str | None, anon_id: str | None) -> Owner | None:
    """Who is asking, for a read.

    No session id to fall back on here, and none is wanted: a read with no
    identity at all has nothing it could be allowed to see, so it resolves to
    an owner that owns nothing rather than to something guessable.

    The re-key runs here as well as on a turn, and it has to. Somebody signs in
    from the card under their first answer and the rail asks for their list
    immediately — before there is a next question to carry the move. Without
    this that list comes back empty, and the conversation they just decided was
    worth keeping looks lost at exactly the moment they acted to keep it.
    """
    owner = await resolve_owner(authorization, anon_id)
    await _claim_anonymous_chats(owner)
    return owner


def _summaries(chats: list[Chat]) -> list[ChatSummary]:
    return [ChatSummary(id=c.id, title=c.title or "New chat", at=c.updated) for c in chats]


@router.get("/chats", response_model=ChatList)
async def list_chats(
    authorization: str | None = Header(default=None),
    anon_id: str | None = Header(default=None, alias=ANON_HEADER),
) -> ChatList:
    """This caller's conversations, newest first.

    Empty for a caller with no identity, which is the honest answer rather than
    a refusal: there is no such thing as somebody else's list to leak here,
    because the key a listing is built from is the caller's own.
    """
    owner = await _reader(authorization, anon_id)
    if owner is None:
        return ChatList(chats=[])
    return ChatList(chats=_summaries(await sessions.list(owner.key, settings.chat_list_limit)))


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def read_chat(
    chat_id: str,
    authorization: str | None = Header(default=None),
    anon_id: str | None = Header(default=None, alias=ANON_HEADER),
) -> ChatDetail:
    """One conversation, if it belongs to whoever is asking.

    Somebody else's conversation is a 404 rather than a 403. A 403 confirms it
    exists, and a chat names positions and amounts — the privacy rule is that
    nothing identifying somebody reaches anybody else by default, and that
    covers the fact of them having asked at all. Sharing is a decision to build
    on the conversation later, not a link that happens to work.
    """
    owner = await _reader(authorization, anon_id)
    chat = await sessions.chat(chat_id, owner.key) if owner else None
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
    chat_id: str,
    authorization: str | None = Header(default=None),
    anon_id: str | None = Header(default=None, alias=ANON_HEADER),
) -> None:
    owner = await _reader(authorization, anon_id)
    if owner is None or not await sessions.delete(chat_id, owner.key):
        raise HTTPException(status_code=404, detail="no such conversation")
