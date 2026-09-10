"""The wire contract: what leaves this service, and in what shape.

Two rules run through all of it.

**Every number is a string.** JSON numbers are IEEE 754 doubles the moment a
client parses them, and these are money and rates: upstream sends decimals of
thirty digits, and a rate wrong in the fourth place is a rate somebody quotes
to a user. Strings survive the trip; the receiver decides what to do with them.

**A rate is worthless without its timestamp.** Every response carries
`meta.as_of` and `meta.stale`, because this service answers from a snapshot and
a caller is entitled to know how old the number is.
"""
from datetime import datetime
from decimal import Decimal, ROUND_DOWN

from pydantic import BaseModel, Field

from .catalog import Snapshot
from .domain import Pool

RATE_PLACES = Decimal("0.000001")
USD_PLACES = Decimal("0.01")
AMOUNT_PLACES = Decimal("0.000000001")


def _q(value: Decimal | None, places: Decimal) -> str | None:
    """Round for the wire, always down.

    Down rather than half-up on purpose: every number here is either what
    somebody will earn or what they can withdraw, and the direction to be wrong
    in is the one that does not promise more than exists.
    """
    if value is None:
        return None
    return str(value.quantize(places, rounding=ROUND_DOWN))


def rate(value: Decimal | None) -> str | None:
    """A fraction, not a percentage: 0.0508 is 5.08% APY."""
    return _q(value, RATE_PLACES)


def usd(value: Decimal | None) -> str | None:
    return _q(value, USD_PLACES)


def amount(value: Decimal | None) -> str | None:
    return _q(value, AMOUNT_PLACES)


class TokenOut(BaseModel):
    symbol: str
    mint: str
    decimals: int | None = None


class ApyOut(BaseModel):
    #: Everything the depositor earns — what a ranking sorts on.
    net: str
    #: What borrowers pay. Keeps paying.
    base: str
    #: Protocol reward programmes (KMNO farms). Ends when the programme does.
    rewards: str
    incentives: str


class ApyWindowsOut(BaseModel):
    """Trailing averages as upstream reports them. Null where it reports none."""

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


class PoolSummary(BaseModel):
    id: str
    network: str
    protocol: str
    kind: str
    name: str
    token: TokenOut
    apy: ApyOut
    tvl_usd: str
    url: str


class PoolDetail(PoolSummary):
    apy_windows: ApyWindowsOut | None = None
    fees: FeesOut | None = None
    liquidity: LiquidityOut
    deposit: DepositOut
    holders: int | None = None
    borrow_apy: str | None = None
    allocations: list[AllocationOut] = Field(default_factory=list)


class TokenSummary(BaseModel):
    """One token, and the best it can do on this network."""

    symbol: str
    mint: str
    decimals: int | None = None
    network: str
    pool_count: int
    best_apy: str
    best_pool_id: str
    tvl_usd: str


class Meta(BaseModel):
    #: When the data in this response was read from upstream.
    as_of: datetime
    #: True when that was longer ago than EARN_STALE_AFTER_S — the numbers are
    #: still real, they are just not fresh.
    stale: bool
    #: Which snapshot answered. Two responses with the same value are consistent
    #: with each other; it is also what a cursor points at.
    snapshot: int
    #: Sources that could not be read when this snapshot was built. Non-empty
    #: means the catalog is incomplete, not merely old.
    degraded: list[str] = Field(default_factory=list)
    count: int | None = None
    total: int | None = None
    next_cursor: str | None = None


class PoolListResponse(BaseModel):
    data: list[PoolSummary]
    meta: Meta


class PoolResponse(BaseModel):
    data: PoolDetail
    meta: Meta


class TokenListResponse(BaseModel):
    data: list[TokenSummary]
    meta: Meta


def meta_of(snapshot: Snapshot, **extra: object) -> Meta:
    return Meta(
        as_of=snapshot.at,
        stale=snapshot.is_stale(),
        snapshot=snapshot.id,
        degraded=list(snapshot.failed),
        **extra,  # type: ignore[arg-type]
    )


def summary_of(pool: Pool) -> PoolSummary:
    return PoolSummary(
        id=pool.id,
        network=pool.network,
        protocol=pool.protocol,
        kind=pool.kind,
        name=pool.name,
        token=TokenOut(symbol=pool.token.symbol, mint=pool.token.mint, decimals=pool.token.decimals),
        apy=ApyOut(
            net=rate(pool.apy.net) or "0",
            base=rate(pool.apy.base) or "0",
            rewards=rate(pool.apy.rewards) or "0",
            incentives=rate(pool.apy.incentives) or "0",
        ),
        tvl_usd=usd(pool.tvl_usd) or "0",
        url=pool.url,
    )


def detail_of(pool: Pool) -> PoolDetail:
    windows = pool.apy_windows
    return PoolDetail(
        **summary_of(pool).model_dump(),
        apy_windows=(
            ApyWindowsOut(
                h24=rate(windows.h24),
                d7=rate(windows.d7),
                d30=rate(windows.d30),
                d90=rate(windows.d90),
                d365=rate(windows.d365),
            )
            if windows
            else None
        ),
        fees=(
            FeesOut(
                performance_bps=pool.fees.performance_bps,
                management_bps=pool.fees.management_bps,
            )
            if pool.fees
            else None
        ),
        liquidity=LiquidityOut(
            deposited=amount(pool.liquidity.deposited) or "0",
            deposited_usd=usd(pool.liquidity.deposited_usd) or "0",
            available=amount(pool.liquidity.available),
            available_usd=usd(pool.liquidity.available_usd),
            utilization=rate(pool.liquidity.utilization),
        ),
        deposit=DepositOut(
            program_id=pool.deposit.program_id,
            address=pool.deposit.address,
            min_amount=amount(pool.deposit.min_amount),
            shares_mint=pool.deposit.shares_mint,
            shares_decimals=pool.deposit.shares_decimals,
            token_program=pool.deposit.token_program,
            lending_market=pool.deposit.lending_market,
        ),
        holders=pool.holders,
        borrow_apy=rate(pool.borrow_apy),
        allocations=[
            AllocationOut(
                reserve=allocation.reserve,
                market=allocation.market,
                market_name=allocation.market_name,
                token_symbol=allocation.token_symbol,
                weight_pct=_q(allocation.weight_pct, Decimal("0.01")) or "0",
            )
            for allocation in pool.allocations
        ],
    )
