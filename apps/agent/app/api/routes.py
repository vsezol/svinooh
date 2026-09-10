"""The HTTP surface: /health for the platform, /chat and /chats for everyone else.

Thin by construction. A handler reads the request, hands it to a use case,
and shapes what comes back. What a turn IS lives in app/application/turns.py,
who may read a conversation in app/application/chats.py, and what a refusal
means on the wire in app/api/errors.py — so a new branch of the conversation
lands in the graph, and a new rule lands in a use case, without this file
changing again.

The block vocabulary is the one thing that IS this layer's: the service draws
an answer as blocks (DESIGN.md), and hands them down to be stored beside it.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse

from ..application.turns import Admitted, Question
from ..container import Container
from ..domain.identity import ANON_HEADER, Caller
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


def _asked(body: ChatRequest) -> Question:
    return Question(message=body.message, session_id=body.session_id, portfolio=body.portfolio)


def _answered(session_id: str, answer: str) -> ChatResponse:
    return ChatResponse(blocks=[TextBlock(text=answer)], reply=answer, session_id=session_id)


def _sign_in_card(question: str) -> SignInBlock:
    """What replaces an answer once the free questions are spent.

    Not a refusal: a 200 carrying a different block, because the person did
    nothing wrong and there is something for them to do. It rides the same
    wire as an answer for the reason every widget does — a new block kind
    rather than a new status code or a new endpoint.
    """
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


async def _remember_card(deps: Container, admitted: Admitted, card: SignInBlock) -> ChatResponse:
    """Record the turn where the answer was a door.

    It happened, so a conversation reopened later shows what was on screen.
    And the client takes this turn's id for the conversation's address: a turn
    that stored nothing would leave /ai/c/<id> pointing at a 404.
    """
    await deps.turns.remember(admitted, card.sub, [card.model_dump(by_alias=True)])
    return ChatResponse(blocks=[card], reply=card.sub, session_id=admitted.session_id)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> ChatResponse:
    admitted = await deps.turns.admit(Caller(authorization, anon_id), _asked(body))
    if admitted.walled:
        return await _remember_card(deps, admitted, _sign_in_card(admitted.question))
    answer = await deps.turns.answer(admitted)
    await deps.turns.remember(admitted, answer, [TextBlock(text=answer).model_dump()])
    return _answered(admitted.session_id, answer)


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
    # Admission happens before the response opens, so a refusal is still a
    # status code rather than a stream that opens and immediately apologises.
    admitted = await deps.turns.admit(Caller(authorization, anon_id), _asked(body))
    card = _sign_in_card(admitted.question) if admitted.walled else None

    async def events() -> AsyncIterator[str]:
        yield _event("start", {"session_id": admitted.session_id})
        if card is not None:
            # No steps and no tokens: nothing ran. The card is the whole turn.
            walled = await _remember_card(deps, admitted, card)
            yield _event("done", walled.model_dump(by_alias=True))
            return
        async for name, data in deps.turns.watch(admitted):
            if name != "done":
                yield _event(name, data)
                continue
            answer = data["text"]
            await deps.turns.remember(admitted, answer, [TextBlock(text=answer).model_dump()])
            yield _event("done", _answered(admitted.session_id, answer).model_dump(by_alias=True))

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


@router.get("/chats", response_model=ChatList)
async def list_chats(
    deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> ChatList:
    chats = await deps.chats.of(Caller(authorization, anon_id))
    return ChatList(
        chats=[ChatSummary(id=c.id, title=c.title or "New chat", at=c.updated) for c in chats]
    )


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def read_chat(
    chat_id: str, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> ChatDetail:
    chat = await deps.chats.one(Caller(authorization, anon_id), chat_id)
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
    await deps.chats.forget(Caller(authorization, anon_id), chat_id)
