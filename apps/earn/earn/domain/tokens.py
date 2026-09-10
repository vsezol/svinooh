"""What a token can earn, summed across the pools that take it.

A derived read model, and a domain computation rather than a query-handler
detail: "the best rate available on USDC" is a sentence about the business, and
the arithmetic behind it should live where the rest of the business does.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from earn.domain.pool import Pool
from earn.domain.values import Usd


@dataclass(frozen=True, slots=True)
class TokenYield:
    """One token, and the best it can do."""

    token_symbol: str
    mint: str
    decimals: int | None
    pool_count: int
    total_tvl: Usd
    #: The pool paying most. Carried whole rather than as an id so the caller
    #: can show the rate and the name without a second lookup.
    best: Pool


def token_yields(pools: Iterable[Pool]) -> tuple[TokenYield, ...]:
    """One row per token, richest first.

    Ordered by money already deposited rather than by rate on purpose: the top
    of this list should be where the market actually is, not wherever the
    thinnest pool happens to be paying most this hour.
    """
    grouped: dict[tuple[str, str], list[Pool]] = {}
    for pool in pools:
        grouped.setdefault((str(pool.network), pool.token.mint), []).append(pool)

    rows = [
        TokenYield(
            token_symbol=max(group, key=lambda pool: pool.apy.net).token.symbol,
            mint=group[0].token.mint,
            decimals=next((pool.token.decimals for pool in group if pool.token.decimals), None),
            pool_count=len(group),
            total_tvl=sum((pool.tvl_usd for pool in group), Usd.ZERO),
            best=max(group, key=lambda pool: pool.apy.net),
        )
        for group in grouped.values()
    ]
    return tuple(sorted(rows, key=lambda row: row.total_tvl, reverse=True))
