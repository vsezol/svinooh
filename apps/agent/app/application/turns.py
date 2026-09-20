import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

from ..domain.asking import Choice
from ..domain.earn import Deposit
from ..domain.errors import (
    EmptyMessageError,
    MessageTooLongError,
    RateLimitedError,
    TurnTimedOutError,
)
from ..domain.identity import Caller, Owner
from ..observability import metrics
from ..ports import Agent, Allowance, Ask, Finished, Progress, RateLimiter, Reply
from .identity import Identity
from .sessions import SessionStore

logger = logging.getLogger("svinooh-ai")


@dataclass(frozen=True)
class Answered:
    text: str
    deposit: Deposit | None = None
    choices: tuple[Choice, ...] = ()


@dataclass(frozen=True)
class Question:
    message: str
    session_id: str | None = None
    portfolio: str | None = None


@dataclass(frozen=True)
class Admitted:
    question: str
    session_id: str
    owner: Owner
    ask: Ask
    walled: bool


class Turns:
    def __init__(
        self,
        sessions: SessionStore,
        identity: Identity,
        limiter: RateLimiter,
        allowance: Allowance,
        agent: Agent,
        deadline_s: int,
        message_max_chars: int,
    ) -> None:
        self._sessions = sessions
        self._identity = identity
        self._limiter = limiter
        self._allowance = allowance
        self._agent = agent
        self._deadline_s = deadline_s
        self._message_max_chars = message_max_chars

    async def admit(self, caller: Caller, asked: Question) -> Admitted:
        question = asked.message.strip()
        if not question:
            raise EmptyMessageError
        if len(question) > self._message_max_chars:
            raise MessageTooLongError(self._message_max_chars)

        owner = await self._identity.resolve(caller.authorization, caller.anon_id)
        retry_after = await self._limiter.retry_after(_budget(owner))
        if retry_after is not None:
            raise RateLimitedError(retry_after)

        await self._sessions.claim(owner)

        session_id, chat, settled = await self._sessions.open_turn(asked.session_id, owner)

        return Admitted(
            question=question,
            session_id=session_id,
            owner=settled,
            walled=not await self._may_ask(settled),
            ask=Ask(
                question=question,
                history=self._sessions.context(chat),
                portfolio=asked.portfolio or (chat.portfolio if chat else None),
                authorization=caller.authorization,
                pending_addresses=tuple(chat.pending) if chat and chat.pending else None,
            ),
        )

    async def answer(self, admitted: Admitted) -> Answered:
        started = time.perf_counter()
        try:
            async with asyncio.timeout(self._deadline_s):
                reply = await self._agent.run(admitted.ask)
        except TimeoutError as expired:
            logger.warning("turn %s ran past %ss", admitted.session_id, self._deadline_s)
            metrics.counted(metrics.turns, outcome="timed_out")
            raise TurnTimedOutError from expired
        except Exception:
            metrics.counted(metrics.turns, outcome="failed")
            raise
        answered = await self._applied(reply, admitted)
        metrics.counted(metrics.turns, outcome="answered")
        metrics.timed(metrics.turn_duration, time.perf_counter() - started)
        return Answered(text=answered, deposit=reply.deposit, choices=reply.choices)

    async def watch(self, admitted: Admitted) -> AsyncIterator[tuple[str, dict]]:
        started = time.perf_counter()
        try:
            async with asyncio.timeout(self._deadline_s):
                async for update in self._agent.watch(admitted.ask):
                    match update:
                        case Progress(kind, payload):
                            yield kind, payload
                        case Finished(reply):
                            yield (
                                "done",
                                {
                                    "text": await self._applied(reply, admitted),
                                    "deposit": reply.deposit,
                                    "choices": reply.choices,
                                },
                            )
                            metrics.counted(metrics.turns, outcome="answered")
                            metrics.timed(metrics.turn_duration, time.perf_counter() - started)
                        case _:
                            yield "error", {"message": update.message}
                            metrics.counted(metrics.turns, outcome="failed")
        except TimeoutError:
            logger.warning("turn %s ran past %ss", admitted.session_id, self._deadline_s)
            metrics.counted(metrics.turns, outcome="timed_out")
            yield "error", {"message": "the answer took too long"}

    async def remember(self, admitted: Admitted, answer: str, blocks: list[dict]) -> None:
        await self._sessions.append(
            admitted.session_id, admitted.owner.key, admitted.question, answer, blocks
        )

    async def _applied(self, reply: Reply, admitted: Admitted) -> str:
        session, owner = admitted.session_id, admitted.owner.key
        if reply.pending_set:
            await self._sessions.set_pending(session, owner, list(reply.pending_set))
        if reply.pending_clear:
            await self._sessions.clear_pending(session)
        if reply.portfolio_created:
            await self._sessions.set_portfolio(session, owner, reply.portfolio_created)
        return reply.answer

    async def _may_ask(self, owner: Owner) -> bool:
        if owner.signed_in:
            return True
        if await self._allowance.charge(owner.key):
            return True
        logger.info("allowance spent for %s — the answer is the sign-in card", owner.key)
        metrics.counted(metrics.turns, outcome="walled")
        return False


def _budget(owner: Owner | None) -> str:
    return f"user:{owner.user_id}" if owner and owner.signed_in else "anonymous"
