"""The seams: what this service needs of the outside world, said as protocols.

Every one of these is something we depend on and do not own. The layers above
name the protocol; app/adapters names the vendor; app/container.py is the one
place the two are introduced to each other. So "replace Redis with a database,
or with an HTTP service" is a new module in adapters plus one line in the
container — never a change in app/application.

`Protocol` rather than an abstract base class, which is the Python way to do
this: an adapter satisfies a port by having the right methods, so nothing has
to import a base to inherit from and the dependency really does point one way.
Runtime type checks are not the point — the point is that a reader of
app/application can see the whole contract without opening an adapter.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

from .domain.conversation import Chat, Turn
from .panel import PanelValues


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


class Panel(Protocol):
    """Where the admin panel's decisions come from (app/panel.py has the values).

    A port because a turn must never wait on the host for them: the adapter
    keeps them fresh in the background, and this only ever answers from hand.
    """

    def current(self) -> PanelValues:
        """The values as last heard; NOTHING_DECIDED until anything was."""

    async def start(self) -> None:
        """Hear the panel before the first turn, then keep hearing it."""

    async def stop(self) -> None:
        """Stop listening; the last values stand."""


@dataclass(frozen=True)
class Ask:
    """What the agent is asked, and everything it is allowed to use.

    The whole input to a turn: the question, what was said before it, the
    portfolio on screen and the caller's token. Nothing else reaches the
    graph, which is what keeps identity out of the model's hands — it picks
    tool arguments, never whose portfolio a tool reads.
    """

    question: str
    history: tuple[Turn, ...] = ()
    portfolio: str | None = None
    authorization: str | None = None
    #: The proposal this conversation is waiting on an answer to.
    pending_addresses: tuple[str, ...] | None = None


@dataclass(frozen=True)
class Reply:
    """What a turn produced, and what it asks the conversation to remember.

    The agent decides; it never writes. Everything below `answer` is an order
    to the session store, carried out by the use case — which is what lets a
    turn be run twice in a test without a store underneath it.
    """

    answer: str
    #: Stash this proposal until the next turn answers it.
    pending_set: tuple[str, ...] | None = None
    #: Drop the proposal — it was confirmed or declined.
    pending_clear: bool = False
    #: The slug the turn created, for the conversation to remember it by.
    portfolio_created: str | None = None


@dataclass(frozen=True)
class Progress:
    """Something to show the reader while the turn is still running.

    `step` is an operation reporting itself, `token` a piece of the answer as
    it is written. The payload is what reaches the widget verbatim, so this
    layer does not describe the work — the code doing it already did.
    """

    kind: Literal["step", "token"]
    payload: dict


@dataclass(frozen=True)
class Finished:
    """The turn is over and produced this."""

    reply: Reply


@dataclass(frozen=True)
class Failed:
    """The turn could not be finished, and the reader is owed an ending."""

    message: str


#: One thing that happened during a watched turn.
Update = Progress | Finished | Failed


class Agent(Protocol):
    """The conversation itself: a question in, an answer and its orders out.

    A port because the use case above it should not know that a graph runs
    underneath, nor which library draws one. Today app/agent/graph.py is the
    only implementation; a test hands the use case something far smaller.
    """

    async def run(self, ask: Ask) -> Reply:
        """One turn, awaited: the answer, once it is finished."""

    def watch(self, ask: Ask) -> AsyncIterator[Update]:
        """The same turn, reported while it happens."""
