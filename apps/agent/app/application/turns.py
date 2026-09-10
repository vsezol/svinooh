"""One chat turn: who may take it, what it runs on, what it leaves behind.

The use case both doors share. /chat awaits an answer and /chat/stream
watches one arrive, but everything that decides what a turn IS — whether the
caller may ask, which conversation it runs in, what the session remembers
afterwards — happens here, once. A door that only one of them checks is a
door.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

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
class Question:
    """What was asked, and the two hints that place it."""

    message: str
    #: The conversation to continue. Absent: a new one is started and named.
    session_id: str | None = None
    #: The portfolio on screen, which is what a money question is about.
    portfolio: str | None = None


@dataclass(frozen=True)
class Admitted:
    """A turn that may run, and everything it needs to."""

    question: str
    session_id: str
    owner: Owner
    ask: Ask
    #: True when a visitor's free questions are spent: the answer is a door
    #: rather than an answer, and the caller decides what that door looks like.
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
        """Check the caller in, and build the state one turn runs on.

        Everything here refuses before any work is done, so a refusal is a
        status code rather than a stream that opens and apologises.
        """
        question = asked.message.strip()
        if not question:
            raise EmptyMessageError
        if len(question) > self._message_max_chars:
            # Refused before it is read by anything we pay per token.
            raise MessageTooLongError(self._message_max_chars)

        # The lock on the door: name the caller, then charge the turn against
        # their budget.
        owner = await self._identity.resolve(caller.authorization, caller.anon_id)
        retry_after = await self._limiter.retry_after(_budget(owner))
        if retry_after is not None:
            raise RateLimitedError(retry_after)

        # Signing in hands the conversations over before the next question,
        # rather than at an endpoint the client has to remember to call.
        await self._sessions.claim(owner)

        # A caller's own live conversation is continued; anything else — no
        # id, an expired one, somebody else's — quietly becomes a new
        # conversation under a new id, which is what keeps a guessable id from
        # being a way to read, extend, or even detect one that is not yours.
        session_id, chat, settled = await self._sessions.open_turn(asked.session_id, owner)

        return Admitted(
            question=question,
            session_id=session_id,
            owner=settled,
            walled=not await self._may_ask(settled),
            # The history and the pending proposal ride into the turn, which
            # is what makes "as we discussed" and "yes, create it" work across
            # requests; the agent decides everything else and never touches
            # the store.
            ask=Ask(
                question=question,
                history=self._sessions.context(chat),
                # The widget's hint wins — it is what is on screen. Behind it,
                # the portfolio this conversation created, so a visitor who has
                # one is grounded in it rather than onboarded a second time.
                portfolio=asked.portfolio or (chat.portfolio if chat else None),
                authorization=caller.authorization,
                pending_addresses=tuple(chat.pending) if chat and chat.pending else None,
            ),
        )

    async def answer(self, admitted: Admitted) -> str:
        """Run the turn, apply what it decided, and hand back the answer.

        Under a deadline, because a turn is several model calls and a tool
        loop: past it the caller is given an ending rather than a connection
        held open on work nobody is waiting for any more.
        """
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
        return answered

    async def watch(self, admitted: Admitted) -> AsyncIterator[tuple[str, dict]]:
        """The same turn, reported while it happens.

        Every event but the last passes through untouched; `done` carries the
        finished answer, once the turn's decisions have been applied.
        """
        started = time.perf_counter()
        try:
            async with asyncio.timeout(self._deadline_s):
                async for update in self._agent.watch(admitted.ask):
                    match update:
                        case Progress(kind, payload):
                            yield kind, payload
                        case Finished(reply):
                            yield "done", {"text": await self._applied(reply, admitted)}
                            metrics.counted(metrics.turns, outcome="answered")
                            metrics.timed(metrics.turn_duration, time.perf_counter() - started)
                        case _:
                            yield "error", {"message": update.message}
                            metrics.counted(metrics.turns, outcome="failed")
        except TimeoutError:
            # The stream is already open, so the deadline is an event rather
            # than a status code — the reader still gets an ending.
            logger.warning("turn %s ran past %ss", admitted.session_id, self._deadline_s)
            metrics.counted(metrics.turns, outcome="timed_out")
            yield "error", {"message": "the answer took too long"}

    async def remember(self, admitted: Admitted, answer: str, blocks: list[dict]) -> None:
        """Record a finished turn, drawn the way the caller drew it.

        Only after the turn produced something, so a failure leaves the
        session exactly as it was rather than holding a question with no
        answer in it. The blocks are stored beside the text, so reopening a
        conversation shows what was on screen rather than a reconstruction of
        it — which is why they arrive from the layer that drew them.
        """
        await self._sessions.append(
            admitted.session_id, admitted.owner.key, admitted.question, answer, blocks
        )

    async def _applied(self, reply: Reply, admitted: Admitted) -> str:
        """Carry out what the turn decided, and hand back the answer.

        The agent stays pure: it names what should be remembered — a proposal
        stashed, a proposal dropped, a portfolio created — and never writes it
        itself. This is where those names become writes.
        """
        session, owner = admitted.session_id, admitted.owner.key
        if reply.pending_set:
            await self._sessions.set_pending(session, owner, list(reply.pending_set))
        if reply.pending_clear:
            await self._sessions.clear_pending(session)
        if reply.portfolio_created:
            await self._sessions.set_portfolio(session, owner, reply.portfolio_created)
        return reply.answer

    async def _may_ask(self, owner: Owner) -> bool:
        """Whether this caller still has a free question.

        An account never meets this: the allowance exists to say where one
        starts, so charging somebody who already has one would charge them for
        the thing they already did.
        """
        if owner.signed_in:
            return True
        if await self._allowance.charge(owner.key):
            return True
        logger.info("allowance spent for %s — the answer is the sign-in card", owner.key)
        metrics.counted(metrics.turns, outcome="walled")
        return False


def _budget(owner: Owner | None) -> str:
    """Whose meter this turn is charged to.

    Deliberately NOT the owner key. Storage keys on the browser's anonymous
    id because that is what history hangs on; a rate limit cannot, because
    that id is soft — a private window mints a new one, so a per-id budget is
    a budget anybody can refill. The anonymous share one bucket: enough to try
    the product, not enough to spend on somebody else's meter.
    """
    return f"user:{owner.user_id}" if owner and owner.signed_in else "anonymous"
