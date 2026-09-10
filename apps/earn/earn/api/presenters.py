"""Domain objects, rendered for the wire.

Rounding happens here and nowhere else — the model keeps full precision, and
only the edge decides how much of it a client is shown. Always *down*: every
number here is either what somebody will earn or what they can withdraw, and
the direction to be wrong in is the one that does not promise more than exists.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import ROUND_DOWN, Decimal

from earn.api.schemas import (
    AllocationOut,
    ApyOut,
    ApyWindowsOut,
    DepositOut,
    FeesOut,
    LiquidityOut,
    MetaOut,
    PoolDetailOut,
    PoolSummaryOut,
    TokenOut,
    TokenYieldOut,
)
from earn.domain.catalog import Catalog
from earn.domain.pool import Pool
from earn.domain.tokens import TokenYield
from earn.domain.values import Rate, Usd

RATE_PLACES = Decimal("0.000001")
USD_PLACES = Decimal("0.01")
AMOUNT_PLACES = Decimal("0.000000001")


def _quantized(value: Decimal | None, places: Decimal) -> str | None:
    return str(value.quantize(places, rounding=ROUND_DOWN)) if value is not None else None


def rate(value: Rate | None) -> str | None:
    """A fraction, not a percentage: "0.050794" is 5.08% APY."""
    return _quantized(value.value if value is not None else None, RATE_PLACES)


def usd(value: Usd | None) -> str | None:
    return _quantized(value.value if value is not None else None, USD_PLACES)


def amount(value: Decimal | None) -> str | None:
    return _quantized(value, AMOUNT_PLACES)


def _required(value: str | None) -> str:
    return value if value is not None else "0"


def meta(catalog: Catalog, now: datetime, stale_after: timedelta, **extra: object) -> MetaOut:
    return MetaOut(
        as_of=catalog.taken_at,
        stale=catalog.is_stale(now, stale_after),
        catalog=catalog.version,
        degraded=list(catalog.failed_sources),
        **extra,
    )


def summary(pool: Pool) -> PoolSummaryOut:
    return PoolSummaryOut(
        id=str(pool.id),
        network=pool.network,
        protocol=pool.protocol,
        kind=pool.kind,
        name=pool.name,
        token=TokenOut(
            symbol=pool.token.symbol, mint=pool.token.mint, decimals=pool.token.decimals
        ),
        apy=ApyOut(
            net=_required(rate(pool.apy.net)),
            base=_required(rate(pool.apy.base)),
            rewards=_required(rate(pool.apy.rewards)),
            incentives=_required(rate(pool.apy.incentives)),
        ),
        tvl_usd=_required(usd(pool.tvl_usd)),
        url=pool.url,
    )


def detail(pool: Pool) -> PoolDetailOut:
    windows = pool.apy_windows
    return PoolDetailOut(
        **summary(pool).model_dump(),
        apy_windows=(
            ApyWindowsOut(
                h24=rate(windows.h24),
                d7=rate(windows.d7),
                d30=rate(windows.d30),
                d90=rate(windows.d90),
                d365=rate(windows.d365),
            )
            if windows is not None
            else None
        ),
        fees=(
            FeesOut(
                performance_bps=pool.fees.performance_bps,
                management_bps=pool.fees.management_bps,
            )
            if pool.fees is not None
            else None
        ),
        liquidity=LiquidityOut(
            deposited=_required(amount(pool.liquidity.deposited)),
            deposited_usd=_required(usd(pool.liquidity.deposited_usd)),
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
                weight_pct=_required(_quantized(allocation.weight_pct, USD_PLACES)),
            )
            for allocation in pool.allocations
        ],
    )


def token_yield(row: TokenYield) -> TokenYieldOut:
    return TokenYieldOut(
        symbol=row.token_symbol,
        mint=row.mint,
        decimals=row.decimals,
        network=row.best.network,
        pool_count=row.pool_count,
        best_apy=_required(rate(row.best.apy.net)),
        best_pool_id=str(row.best.id),
        tvl_usd=_required(usd(row.total_tvl)),
    )
