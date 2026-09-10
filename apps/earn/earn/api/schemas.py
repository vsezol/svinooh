"""What leaves this service, and in what shape.

Two rules run through all of it.

**Every number is a string.** JSON numbers become IEEE 754 doubles the moment a
client parses them, and these are money and rates: upstream sends decimals of
thirty digits, and a rate wrong in the fourth place is a rate somebody quotes
to a user. Strings survive the trip; the receiver decides what to do with them.

**Every answer is timestamped.** `meta.as_of` and `meta.stale` are not
diagnostics — this service answers from a catalog, and a rate with no time on
it is not a fact.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TokenOut(BaseModel):
    symbol: str
    mint: str
    decimals: int | None = None


class ApyOut(BaseModel):
    #: Everything the depositor earns — what a ranking sorts on.
    net: str
    #: What borrowers pay. Keeps paying.
    base: str
    #: Protocol reward programmes. End when the programme does.
    rewards: str
    incentives: str


class ApyWindowsOut(BaseModel):
    h24: str | None = None
    d7: str | None = None
    d30: str | None = None
    d90: str | None = None
    d365: str | None = None


class LiquidityOut(BaseModel):
    deposited: str
    deposited_usd: str
    available: str | None = None
    available_usd: str | None = None
    utilization: str | None = None


class FeesOut(BaseModel):
    performance_bps: int
    management_bps: int


class DepositOut(BaseModel):
    """The accounts a deposit touches. Read-only today; the input to signing later."""

    program_id: str
    address: str
    min_amount: str | None = None
    shares_mint: str | None = None
    shares_decimals: int | None = None
    token_program: str | None = None
    lending_market: str | None = None


class AllocationOut(BaseModel):
    reserve: str
    market: str
    market_name: str
    token_symbol: str
    weight_pct: str


class PoolSummaryOut(BaseModel):
    id: str
    network: str
    protocol: str
    kind: str
    name: str
    token: TokenOut
    apy: ApyOut
    tvl_usd: str
    url: str


class PoolDetailOut(PoolSummaryOut):
    apy_windows: ApyWindowsOut | None = None
    fees: FeesOut | None = None
    liquidity: LiquidityOut
    deposit: DepositOut
    holders: int | None = None
    borrow_apy: str | None = None
    allocations: list[AllocationOut] = Field(default_factory=list)


class TokenYieldOut(BaseModel):
    """One token, and the best it can do on this network."""

    symbol: str
    mint: str
    decimals: int | None = None
    network: str
    pool_count: int
    best_apy: str
    best_pool_id: str
    tvl_usd: str


class MetaOut(BaseModel):
    #: When the data in this response was read from upstream.
    as_of: datetime
    #: True once that was longer ago than EARN_STALE_AFTER_S. The numbers are
    #: still real; they are just not fresh.
    stale: bool
    #: Which catalog answered. Two responses carrying the same value are
    #: consistent with each other; it is also what a cursor points at.
    catalog: int
    #: Sources that could not be read when it was built. Non-empty means the
    #: catalog is incomplete, which is a different problem from old.
    degraded: list[str] = Field(default_factory=list)
    count: int | None = None
    total: int | None = None
    next_cursor: str | None = None


class PoolListResponse(BaseModel):
    data: list[PoolSummaryOut]
    meta: MetaOut


class PoolResponse(BaseModel):
    data: PoolDetailOut
    meta: MetaOut


class TokenListResponse(BaseModel):
    data: list[TokenYieldOut]
    meta: MetaOut


class HealthResponse(BaseModel):
    status: str
    catalog: int | None = None
    as_of: datetime | None = None
    age_s: int | None = None
    stale: bool | None = None
    pools: int | None = None
    degraded: list[str] = Field(default_factory=list)
