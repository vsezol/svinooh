"""What the earn catalog offers, and how risky each offer is.

The facts are the catalog's; the risk band is ours, because it is a judgement
about those facts rather than one of them.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

RiskBand = Literal["low", "medium", "high"]

#: Under this much deposited, the rate is real but untested by size.
THIN_TVL_USD = Decimal("5000000")
#: Above this share of the rate coming from a programme rather than borrowers,
#: the headline number is mostly something that ends on a date somebody chose.
MOSTLY_PROGRAMMES = Decimal("0.5")


@dataclass(frozen=True, slots=True)
class YieldPool:
    """One place to deposit one token and be paid for it."""

    id: str
    name: str
    protocol: str
    #: `vault` — a curator spreads the deposit; `reserve` — one market, direct.
    kind: str
    token: str
    apy_net: Decimal
    #: What borrowers pay, and keep paying.
    apy_base: Decimal
    #: The protocol's own reward programme, which ends.
    apy_rewards: Decimal
    #: Somebody else's programme paid through the same pool, which also ends.
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
    def risk_reasons(self) -> tuple[str, ...]:
        """What is risky about this pool, in words a reader can disagree with."""
        reasons = []
        if self.kind == "reserve":
            reasons.append("one market's reserve rather than a curated spread")
        if self.tvl_usd < THIN_TVL_USD:
            reasons.append("thin: under $5M deposited")
        if self.programme_share >= MOSTLY_PROGRAMMES:
            reasons.append("most of the rate is a reward programme, which ends")
        return tuple(reasons)

    @property
    def risk(self) -> RiskBand:
        """The band those reasons add up to: none, one, or more than one."""
        return ("low", "medium", "high")[min(len(self.risk_reasons), 2)]


@dataclass(frozen=True, slots=True)
class CatalogSnapshot:
    """The pools the catalog answered with, and when it read them."""

    pools: tuple[YieldPool, ...]
    as_of: datetime | None = None
    #: The catalog could not refresh, so these rates are older than usual.
    stale: bool = False
