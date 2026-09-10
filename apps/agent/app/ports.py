"""The seams: what this service needs of the outside world, said as protocols.

Every one of these is something we depend on and do not own. The layers above
name the protocol; app/adapters names the vendor; app/composition.py is the one
place the two are introduced to each other. So "replace Redis with a database,
or with an HTTP service" is a new module in adapters plus one line in the
composition root — never a change in app/services.

`Protocol` rather than an abstract base class, which is the Python way to do
this: an adapter satisfies a port by having the right methods, so nothing has
to import a base to inherit from and the dependency really does point one way.
Runtime type checks are not the point — the point is that a reader of
app/services can see the whole contract without opening an adapter.
"""
from typing import Protocol

from .domain.conversation import Chat


class ConversationStore(Protocol):
    """Where conversations are kept.

    Deliberately narrow: exactly what keeping and listing conversations needs,
    and nothing that happens to be easy in Redis. A generic key-value facade
    would make the in-memory implementation a second Redis, and make an HTTP
    implementation impossible to write honestly.

    Two obligations every implementation carries, because they are the contract
    rather than an optimisation:

    - a conversation expires CHAT_TTL_S after its last turn, and its owner's
      listing must not outlive the conversations in it;
    - `for_owner` must never return a conversation that has expired, even if
      whatever index it keeps still mentions one.
    """

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

    async def close(self) -> None: ...


class RateLimiter(Protocol):
    """How often one caller may ask.

    A port rather than a class because the counting has to be shared across
    instances to mean anything, and where it is shared is not this service's
    business — today Redis, tomorrow whatever else counts.
    """

    async def retry_after(self, key: str) -> int | None:
        """Charge one attempt; None means allowed, a number is seconds to wait."""


class Allowance(Protocol):
    """How many questions a caller gets for free before they need an account.

    A separate port from RateLimiter although the arithmetic is the same, because
    the two answer different questions and are allowed to diverge: one is a cost
    lock charged to a shared bucket, the other is a product limit charged to one
    visitor. Keeping them apart is what lets the allowance be per-identity while
    the cost lock stays deliberately not.
    """

    async def charge(self, key: str) -> bool:
        """Spend one question; True while there are any left."""
