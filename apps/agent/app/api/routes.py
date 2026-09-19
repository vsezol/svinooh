import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..application.turns import Admitted, Answered, Question
from ..container import Container
from ..domain.earn import Deposit
from ..domain.identity import ANON_HEADER, Caller
from ..observability import metrics
from ..panel import NOTHING_DECIDED
from .schemas import (
    ChatDetail,
    ChatList,
    ChatRequest,
    ChatResponse,
    ChatSummary,
    ChatTurn,
    DepositBlock,
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


@router.get("/metrics")
def scrape() -> Response:
    body, content_type = metrics.render()
    return Response(content=body, media_type=content_type)


@router.get("/ready")
async def ready(deps: Deps) -> JSONResponse:
    store = await deps.store_state()
    body = {
        "ok": store != "unreachable",
        "store": store,
        "panel": "heard" if deps.panel.current() != NOTHING_DECIDED else "not heard yet",
        "model": deps.config.answering().model,
    }
    return JSONResponse(status_code=200 if body["ok"] else 503, content=body)


def _asked(body: ChatRequest) -> Question:
    return Question(message=body.message, session_id=body.session_id, portfolio=body.portfolio)


def _answered(session_id: str, answered: Answered) -> ChatResponse:
    return ChatResponse(blocks=_blocks(answered), reply=answered.text, session_id=session_id)


def _blocks(answered: Answered) -> list[TextBlock | SignInBlock | DepositBlock]:
    drawn: list[TextBlock | SignInBlock | DepositBlock] = [TextBlock(text=answered.text)]
    if answered.deposit is not None:
        drawn.append(_deposit_card(answered.deposit))
    return drawn


def _deposit_card(deposit: Deposit) -> DepositBlock:
    pool = deposit.pool
    return DepositBlock(
        pool_id=pool.id,
        pool=pool.name,
        protocol=pool.protocol,
        pool_kind=pool.kind,
        network=pool.network,
        token=pool.token,
        amount=f"{deposit.amount:f}",
        apy=f"{pool.apy_net * 100:.2f}%",
        risk=pool.risk,
        url=pool.url,
    )


def _sign_in_card(question: str) -> SignInBlock:
    return SignInBlock(
        title="Sign in to keep asking",
        sub=(
            "That is the free questions used up. An account continues this "
            "conversation — and claims a portfolio made here, which until then "
            "belongs to nobody."
        ),
        pending_question=question,
    )


async def _remember_card(deps: Container, admitted: Admitted, card: SignInBlock) -> ChatResponse:
    await deps.turns.remember(admitted, card.sub, [card.model_dump(by_alias=True)])
    return ChatResponse(blocks=[card], reply=card.sub, session_id=admitted.session_id)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> ChatResponse:
    admitted = await deps.turns.admit(Caller(authorization, anon_id), _asked(body))
    if admitted.walled:
        return await _remember_card(deps, admitted, _sign_in_card(admitted.question))
    answered = await deps.turns.answer(admitted)
    drawn = _blocks(answered)
    await deps.turns.remember(
        admitted, answered.text, [block.model_dump(by_alias=True) for block in drawn]
    )
    return ChatResponse(blocks=drawn, reply=answered.text, session_id=admitted.session_id)


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest, deps: Deps, authorization: Authorization = None, anon_id: AnonId = None
) -> StreamingResponse:
    admitted = await deps.turns.admit(Caller(authorization, anon_id), _asked(body))
    card = _sign_in_card(admitted.question) if admitted.walled else None

    async def events() -> AsyncIterator[str]:
        yield _event("start", {"session_id": admitted.session_id})
        if card is not None:
            walled = await _remember_card(deps, admitted, card)
            yield _event("done", walled.model_dump(by_alias=True))
            return
        async for name, data in deps.turns.watch(admitted):
            if name != "done":
                yield _event(name, data)
                continue
            answered = Answered(text=data["text"], deposit=data.get("deposit"))
            drawn = _blocks(answered)
            await deps.turns.remember(
                admitted, answered.text, [block.model_dump(by_alias=True) for block in drawn]
            )
            yield _event("done", _answered(admitted.session_id, answered).model_dump(by_alias=True))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


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
