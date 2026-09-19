"""What the earn catalog offers, and how risky each offer is.

The facts are the catalog's; the risk band is ours, because it is a judgement
about those facts rather than one of them.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

RiskBand = Literal["low", "medium", "high"]

#: Under this much deposited, one withdrawal moves the pool and the exit is small.
THIN_TVL_USD = Decimal("5000000")
#: Above this share of the rate coming from a programme rather than borrowers,
#: the headline number is mostly something that ends on a date somebody chose.
MOSTLY_PROGRAMMES = Decimal("0.5")


@dataclass(frozen=True, slots=True)
class DepositTerms:
    program_id: str
    address: str
    token_mint: str
    token_decimals: int | None = None
    min_amount: Decimal | None = None
    shares_mint: str | None = None
    shares_decimals: int | None = None
    token_program: str | None = None
    lending_market: str | None = None


@dataclass(frozen=True, slots=True)
class YieldPool:
    """One place to deposit one token and be paid for it."""

    id: str
    name: str
    protocol: str
    #: `vault` — a curator spreads the deposit; `reserve` — one market, direct.
    kind: str
    network: str
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
    terms: DepositTerms | None = None

    @property
    def programme_share(self) -> Decimal:
        """How much of the rate is a programme rather than borrowers paying."""
        if self.apy_net <= 0:
            return Decimal(0)
        return (self.apy_rewards + self.apy_incentives) / self.apy_net

    @property
    def is_thin(self) -> bool:
        return self.tvl_usd < THIN_TVL_USD

    @property
    def is_single_market(self) -> bool:
        return self.kind == "reserve"

    @property
    def pays_mostly_programmes(self) -> bool:
        return self.programme_share >= MOSTLY_PROGRAMMES

    @property
    def risk(self) -> RiskBand:
        """Thin is what can cost the deposit; the rest only costs the rate."""
        if self.is_thin:
            return "high"
        if self.is_single_market or self.pays_mostly_programmes:
            return "medium"
        return "low"

    @property
    def risk_reasons(self) -> tuple[str, ...]:
        """The same facts the band reads, in words a reader can disagree with."""
        reasons = []
        if self.is_thin:
            reasons.append("thin: under $5M deposited")
        if self.is_single_market:
            reasons.append("one market's reserve rather than a curated spread")
        if self.pays_mostly_programmes:
            reasons.append("most of the rate is a reward programme, which ends")
        return tuple(reasons)


@dataclass(frozen=True, slots=True)
class Deposit:
    pool: YieldPool
    amount: Decimal
    terms: DepositTerms

    @property
    def below_minimum(self) -> bool:
        minimum = self.terms.min_amount
        return minimum is not None and self.amount < minimum


@dataclass(frozen=True, slots=True)
class CatalogSnapshot:
    """The pools the catalog answered with, and when it read them."""

    pools: tuple[YieldPool, ...]
    as_of: datetime | None = None
    #: The catalog could not refresh, so these rates are older than usual.
    stale: bool = False
