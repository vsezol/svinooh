"""Where a token can be put to work, and how much is risked to get the rate.

The facts belong to the earn service: what the pool is, what it pays, how much
sits in it. The RISK BAND does not. It is a judgement about those facts, and a
judgement is the agent's to make — kept here so the wording can change with
what people misread, without a wire contract moving underneath it.

Every number is a Decimal. They arrive from the catalog as strings for exactly
that reason: these are rates and money, and a rate wrong in the fourth place is
a rate somebody quotes to a person.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

#: How the bands are named where a person reads them.
Risk = Literal["low", "medium", "high"]

#: Under this much deposited, a pool is thin: the rate is real but it has not
#: been tested by size, and getting out of it is a smaller door.
THIN_TVL_USD = Decimal("5000000")

#: Above this share of the rate coming from a programme rather than from
#: borrowers, the headline number is mostly something that ends on a date
#: somebody else chose.
MOSTLY_PROGRAMMES = Decimal("0.5")


@dataclass(frozen=True, slots=True)
class Option:
    """One place to deposit one token, as the agent reasons about it."""

    id: str
    name: str
    protocol: str
    #: `vault` — a curator spreads the deposit; `reserve` — one market, direct.
    kind: str
    token: str
    apy_net: Decimal
    apy_base: Decimal
    #: A protocol's own reward programme.
    apy_rewards: Decimal
    #: Somebody else's programme paid through the same pool. Kept apart from
    #: `rewards` because the catalog keeps them apart — and counted with it
    #: here, because to a depositor both are money that stops arriving on a
    #: date they did not choose. The pool that made this obvious paid 7.07%
    #: from borrowers and 4.41% from incentives, with rewards at zero: reading
    #: only `rewards` called that a borrower-paid rate.
    apy_incentives: Decimal
    tvl_usd: Decimal
    url: str

    @property
    def programme_share(self) -> Decimal:
        """How much of the rate is a programme rather than borrowers paying."""
        if self.apy_net <= 0:
            return Decimal(0)
        return (self.apy_rewards + self.apy_incentives) / self.apy_net

    @property
    def caveats(self) -> tuple[str, ...]:
        """Everything about this pool that a careful person would want said.

        The band below is these, counted. Stating them rather than scoring
        silently is the whole point: a person can disagree with one, and
        "medium" with no reasons behind it is a number pretending to be advice.
        """
        marks: list[str] = []
        if self.kind == "reserve":
            marks.append("one market's reserve rather than a curated spread")
        if self.tvl_usd < THIN_TVL_USD:
            marks.append("thin: under $5M deposited")
        if self.programme_share >= MOSTLY_PROGRAMMES:
            marks.append("most of the rate is a reward programme, which ends")
        return tuple(marks)

    @property
    def risk(self) -> Risk:
        """The band, as the count of what is worth saying about it."""
        return ("low", "medium", "high")[min(len(self.caveats), 2)]


@dataclass(frozen=True, slots=True)
class Listing:
    """What the catalog answered, and when it was true.

    `as_of` and `stale` travel with the options rather than beside them: a rate
    with no time on it is not a fact, and the one place that can say so out
    loud is the answer being written from it.
    """

    options: tuple[Option, ...]
    as_of: datetime | None = None
    stale: bool = False
