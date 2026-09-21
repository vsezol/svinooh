from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

RiskBand = Literal["low", "medium", "high"]

THIN_TVL_USD = Decimal("5000000")
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
    id: str
    name: str
    protocol: str
    kind: str
    network: str
    token: str
    apy_net: Decimal
    apy_base: Decimal
    apy_rewards: Decimal
    apy_incentives: Decimal
    tvl_usd: Decimal
    url: str
    terms: DepositTerms | None = None

    @property
    def programme_share(self) -> Decimal:
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
        if self.is_thin:
            return "high"
        if self.is_single_market or self.pays_mostly_programmes:
            return "medium"
        return "low"

    @property
    def risk_reasons(self) -> tuple[str, ...]:
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


SettledStatus = Literal["landed", "failed", "sent", "refused"]


@dataclass(frozen=True, slots=True)
class Settled:
    amount: str
    token: str
    pool: str
    status: SettledStatus
    signature: str | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class CatalogSnapshot:
    pools: tuple[YieldPool, ...]
    as_of: datetime | None = None
    stale: bool = False
