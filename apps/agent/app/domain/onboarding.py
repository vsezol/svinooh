"""What the agent's one write produces, said in the domain's own terms.

The outcome of creating a portfolio from a conversation: which addresses went
in, which the host refused and why, and whether the thing that now exists
belongs to anybody. A type rather than a dict because the answer relayed to
the user is built from it, and a `.get()` that returns None there is a
sentence claiming something did not happen when it did.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Refused:
    """An address the host would not take, and what it said about it."""

    address: str
    reason: str


@dataclass(frozen=True)
class Created:
    """A portfolio that now exists, and what actually went into it.

    `anonymous` is what the caller must relay: a portfolio belonging to nobody
    is public and claimable, and a person should be told that before they
    treat it as theirs.
    """

    slug: str
    added: tuple[str, ...] = ()
    refused: tuple[Refused, ...] = ()
    anonymous: bool = False
