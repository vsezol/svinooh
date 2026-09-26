from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

from .domain.asking import Choice
from .domain.conversation import Chat, Turn
from .domain.earn import Card, Settled
from .panel import PanelValues


class ConversationStore(Protocol):
    async def load(self, chat_id: str) -> Chat | None:
        """One conversation by id, or None when there is nothing at that id."""

    async def save(self, chat: Chat) -> None:
        """Write it, and push its expiry — and its owner's listing — back out."""

    async def for_owner(self, owner: str, limit: int) -> list[Chat]:
        """That owner's conversations, newest first, expired ones excluded."""

    async def delete(self, chat: Chat) -> None: ...

    async def has_any(self, owner: str) -> bool:
        """Whether this owner has anything at all — the cheap re-key check."""

    async def reassign(self, source: str, target: str) -> int:
        """Move every conversation from one owner to another; returns how many."""


class Strategies(Protocol):
    async def lpdown(self, portfolio: str) -> frozenset[str]:
        """The liquidity positions of this portfolio that /lpdown opened, and so moves."""

    async def adopt(self, portfolio: str, position: str) -> None: ...

    async def drop(self, portfolio: str, position: str) -> None: ...


class RateLimiter(Protocol):
    async def retry_after(self, key: str) -> int | None:
        """Charge one attempt; None means allowed, a number is seconds to wait."""


class Allowance(Protocol):
    async def charge(self, key: str) -> bool:
        """Spend one question; True while there are any left."""


class Panel(Protocol):
    def current(self) -> PanelValues:
        """The values as last heard; NOTHING_DECIDED until anything was."""

    async def start(self) -> None:
        """Hear the panel before the first turn, then keep hearing it."""

    async def stop(self) -> None:
        """Stop listening; the last values stand."""


@dataclass(frozen=True)
class Ask:
    question: str
    history: tuple[Turn, ...] = ()
    portfolio: str | None = None
    authorization: str | None = None
    pending_addresses: tuple[str, ...] | None = None
    settled: Settled | None = None


@dataclass(frozen=True)
class Reply:
    answer: str
    pending_set: tuple[str, ...] | None = None
    pending_clear: bool = False
    portfolio_created: str | None = None
    deposits: tuple[Card, ...] = ()
    choices: tuple[Choice, ...] = ()


@dataclass(frozen=True)
class Progress:
    kind: Literal["step", "token"]
    payload: dict


@dataclass(frozen=True)
class Finished:
    reply: Reply


@dataclass(frozen=True)
class Failed:
    message: str


Update = Progress | Finished | Failed


class Agent(Protocol):
    async def run(self, ask: Ask) -> Reply:
        """One turn, awaited: the answer, once it is finished."""

    def watch(self, ask: Ask) -> AsyncIterator[Update]:
        """The same turn, reported while it happens."""
