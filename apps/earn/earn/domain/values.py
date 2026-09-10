"""The vocabulary: the small types the rest of the model is written in.

A value object earns its place when it carries an invariant the language will
not otherwise enforce. Two do here, and one deliberately does not.

`Rate` is the important one. Yields are quoted two ways — 5.08 and 0.0508 — and
they look identical in a `Decimal`. Every part of this system that has ever
been wrong about a number was wrong about which of the two it was holding.
A type that can only be a fraction makes that mistake fail to compile.

`Usd` is cheap and stops money being added to a rate.

An address is deliberately left as `str`. Wrapping it would touch every field
and catch nothing: the addresses come from upstream already valid, and the one
real failure — an empty one — is caught where the payload is mapped. A type
that adds ceremony without adding a guarantee is a cost with no benefit.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import ClassVar, Self


class Network(StrEnum):
    """The chain a pool lives on.

    Distinct from the repo's `Chain`, which is the family a wallet belongs to:
    one EVM wallet holds positions on a dozen networks, and a pool is on
    exactly one of them. Spelled as the rest of the product spells networks.
    """

    SOLANA = "sol"


class Protocol(StrEnum):
    KAMINO = "kamino"


class PoolKind(StrEnum):
    """How the deposit is held.

    Both pay for a single-token deposit, which is why they are one model — but
    they are not the same thing to sign, and a caller choosing between them is
    choosing between "a curator decides" and "I decide".
    """

    #: A curator spreads the deposit across lending reserves; you hold a share token.
    VAULT = "vault"
    #: Supplied straight into one market's reserve; its borrowers pay you.
    RESERVE = "reserve"


@dataclass(frozen=True, slots=True, order=True)
class Rate:
    """An annual rate, always as a fraction: `Rate(Decimal("0.0508"))` is 5.08%.

    Ordering is defined because ranking by yield is the service's whole job.
    """

    value: Decimal

    #: A `ClassVar` rather than a field — an annotated name in a dataclass body
    #: is a field unless it says otherwise, and `ZERO` is a constant.
    ZERO: ClassVar[Rate]

    def __add__(self, other: Rate) -> Rate:
        # Checked at runtime and not only by the type checker: a `Usd` also has
        # a `.value`, so without this the two would add happily and the whole
        # point of the type would be a comment.
        if not isinstance(other, Rate):
            return NotImplemented
        return Rate(self.value + other.value)

    def as_percent(self) -> Decimal:
        """Only for a human-facing string. Never feed this back into a `Rate`."""
        return self.value * 100

    def is_positive(self) -> bool:
        return self.value > 0


@dataclass(frozen=True, slots=True, order=True)
class Usd:
    """An amount of money, in dollars."""

    value: Decimal

    ZERO: ClassVar[Usd]

    def __add__(self, other: Usd) -> Usd:
        if not isinstance(other, Usd):
            return NotImplemented
        return Usd(self.value + other.value)


# Assigned after the classes exist, because a constant of a type cannot be
# built inside that type's own body. One shared zero reads better than
# `Rate(Decimal(0))` scattered everywhere.
Rate.ZERO = Rate(Decimal(0))
Usd.ZERO = Usd(Decimal(0))


@dataclass(frozen=True, slots=True)
class PoolId:
    """What a client stores and comes back with.

    Self-contained on purpose: network, protocol, kind and address, so a stored
    id resolves without remembering which list it came out of. Colons are legal
    in a path segment (RFC 3986 `pchar`), so it needs no escaping in a URL.
    """

    network: Network
    protocol: Protocol
    kind: PoolKind
    address: str

    def __str__(self) -> str:
        return f"{self.network}:{self.protocol}:{self.kind}:{self.address}"

    @classmethod
    def parse(cls, raw: str) -> Self | None:
        """The inverse, for an id arriving from a client. None if it is not one.

        None rather than an exception: a malformed id in a URL is
        indistinguishable from an id for a pool that does not exist, and both
        answers are the same 404.
        """
        parts = raw.split(":")
        if len(parts) != 4:
            return None
        network, protocol, kind, address = parts
        if not address:
            return None
        try:
            return cls(Network(network), Protocol(protocol), PoolKind(kind), address)
        except ValueError:
            return None
