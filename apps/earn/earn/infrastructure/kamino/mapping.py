"""Kamino's payloads, turned into our model.

This is the only file that knows Kamino's field names, and the only one that
has to be tolerant: upstream sends numbers as strings of thirty digits,
sometimes in scientific notation, sometimes missing, occasionally null. None of
that is worth failing a refresh over, so a field we cannot read is a field we
do not have — and the domain never sees a `str` where it expects a `Rate`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from earn.domain.pool import (
    Allocation,
    Apy,
    ApyWindows,
    DepositTerms,
    Fees,
    Liquidity,
    Pool,
    Token,
)
from earn.domain.values import Network, PoolId, PoolKind, Protocol, Rate, Usd
from earn.infrastructure.kamino.api import (
    MarketReserves,
    ReserveMetricsPayload,
    VaultMetricsPayload,
    VaultPayload,
)

#: Kamino's two on-chain programs. A vault payload carries its own `programId`
#: and that is preferred; this is the fallback, and the constant for reserves,
#: which the market API does not report.
KVAULT_PROGRAM = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
KLEND_PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"

APP = "https://kamino.com"


def to_decimal(value: object, default: Decimal | None = Decimal(0)) -> Decimal | None:
    if value is None:
        return default
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default
    return default if not parsed.is_finite() else parsed


def _decimal(value: object) -> Decimal:
    return to_decimal(value) or Decimal(0)


def _rate(value: object) -> Rate:
    return Rate(_decimal(value))


def _rate_or_none(value: object) -> Rate | None:
    parsed = to_decimal(value, None)
    return Rate(parsed) if parsed is not None else None


def _usd(value: object) -> Usd:
    return Usd(_decimal(value))


@dataclass(frozen=True, slots=True)
class Index:
    """What one part of Kamino's API knows that another part needs.

    A vault names its token by mint address only, and names its allocations by
    reserve address only; reserve metrics are where the ticker and the owning
    market are written down. Building this once per refresh is what lets a
    vault be described in words instead of base58.
    """

    #: mint -> ticker
    symbols: dict[str, str] = field(default_factory=dict)
    #: mint -> decimals, learned from the vaults that state them. Reserve
    #: metrics never report decimals, so a mint with no vault keeps None rather
    #: than being assumed to be six.
    decimals: dict[str, int] = field(default_factory=dict)
    #: lending market -> display name
    market_names: dict[str, str] = field(default_factory=dict)
    #: reserve -> the market it belongs to
    reserve_markets: dict[str, str] = field(default_factory=dict)
    #: reserve -> the ticker it lends
    reserve_tokens: dict[str, str] = field(default_factory=dict)

    @classmethod
    def build(cls, vaults: list[VaultPayload], per_market: list[MarketReserves]) -> Index:
        index = cls()
        for entry in per_market:
            index.market_names[entry["market"]] = entry["name"]
            for reserve in entry["reserves"]:
                mint, address = reserve.get("liquidityTokenMint"), reserve.get("reserve")
                ticker = (reserve.get("liquidityToken") or "").upper()
                if mint and ticker:
                    index.symbols.setdefault(mint, ticker)
                if address:
                    index.reserve_markets[address] = entry["market"]
                    index.reserve_tokens[address] = ticker or "?"
        for vault in vaults:
            state = vault.get("state") or {}
            mint, decimals = state.get("tokenMint"), state.get("tokenMintDecimals")
            if mint and isinstance(decimals, int):
                index.decimals.setdefault(mint, decimals)
        return index


def vault_to_pool(
    vault: VaultPayload, metrics: VaultMetricsPayload, index: Index
) -> Pool | None:
    """A curated vault. None when the payload lacks what identifies it."""
    state = vault.get("state") or {}
    address, mint = vault.get("address"), state.get("tokenMint")
    if not address or not mint:
        return None

    invested_usd = _usd(metrics.get("tokensInvestedUsd"))
    available_usd = _usd(metrics.get("tokensAvailableUsd"))
    decimals = state.get("tokenMintDecimals")

    return Pool(
        id=PoolId(Network.SOLANA, Protocol.KAMINO, PoolKind.VAULT, address),
        name=(state.get("name") or "").strip() or f"Kamino vault {address[:8]}",
        token=Token(
            symbol=index.symbols.get(mint) or "?",
            mint=mint,
            decimals=decimals if isinstance(decimals, int) else None,
        ),
        # `apy` is the base rate and excludes the reward programmes — checked
        # against kamino.com, where Sentora PYUSD reads 5.08% and apy 2.575% +
        # apyFarmRewards 2.504% is exactly that.
        apy=Apy(
            base=_rate(metrics.get("apy")),
            rewards=_rate(metrics.get("apyFarmRewards")),
            incentives=_rate(metrics.get("apyIncentives"))
            + _rate(metrics.get("apyReservesIncentives")),
        ),
        tvl_usd=invested_usd + available_usd,
        liquidity=Liquidity(
            deposited=_decimal(metrics.get("tokensInvested"))
            + _decimal(metrics.get("tokensAvailable")),
            deposited_usd=invested_usd + available_usd,
            available=_decimal(metrics.get("tokensAvailable")),
            available_usd=available_usd,
        ),
        deposit=DepositTerms(
            program_id=vault.get("programId") or KVAULT_PROGRAM,
            address=address,
            min_amount=_min_deposit(state.get("minDepositAmount"), decimals),
            shares_mint=state.get("sharesMint"),
            shares_decimals=state.get("sharesMintDecimals"),
            token_program=state.get("tokenProgram"),
        ),
        url=f"{APP}/earn/lend/{address}",
        apy_windows=ApyWindows(
            h24=_rate_or_none(metrics.get("apy24h")),
            d7=_rate_or_none(metrics.get("apy7d")),
            d30=_rate_or_none(metrics.get("apy30d")),
            d90=_rate_or_none(metrics.get("apy90d")),
            d365=_rate_or_none(metrics.get("apy365d")),
        ),
        fees=Fees(
            performance_bps=int(state.get("performanceFeeBps") or 0),
            management_bps=int(state.get("managementFeeBps") or 0),
        ),
        holders=_int_or_none(metrics.get("numberOfHolders")),
        allocations=_allocations(state.get("vaultAllocationStrategy") or [], index),
    )


def reserve_to_pool(
    reserve: ReserveMetricsPayload, market: str, market_name: str, index: Index
) -> Pool | None:
    """Direct supply into one market's reserve."""
    address, mint = reserve.get("reserve"), reserve.get("liquidityTokenMint")
    if not address or not mint:
        return None

    supplied = _decimal(reserve.get("totalSupply"))
    borrowed = _decimal(reserve.get("totalBorrow"))
    symbol = (reserve.get("liquidityToken") or "?").upper()

    return Pool(
        id=PoolId(Network.SOLANA, Protocol.KAMINO, PoolKind.RESERVE, address),
        name=f"{symbol} · {market_name}",
        token=Token(symbol=symbol, mint=mint, decimals=index.decimals.get(mint)),
        # These metrics report the rate borrowers pay and nothing else.
        # Reserve-level reward programmes exist and are not carried here, so
        # rewards stay zero rather than being guessed at.
        apy=Apy(base=_rate(reserve.get("supplyApy"))),
        tvl_usd=_usd(reserve.get("totalSupplyUsd")),
        liquidity=Liquidity(
            deposited=supplied,
            deposited_usd=_usd(reserve.get("totalSupplyUsd")),
            available=supplied - borrowed,
            utilization=Rate(borrowed / supplied) if supplied > 0 else Rate.ZERO,
        ),
        deposit=DepositTerms(program_id=KLEND_PROGRAM, address=address, lending_market=market),
        url=f"{APP}/borrow/reserve/{market}/{address}",
        borrow_apy=_rate(reserve.get("borrowApy")),
    )


def _allocations(raw: list[Any], index: Index) -> tuple[Allocation, ...]:
    """Where the money actually is.

    A weight of zero means the curator has moved off that reserve. It stays in
    the on-chain strategy, but listing it would misdescribe the risk, so the
    weights are renormalised over the ones that are live.
    """
    live = [
        (entry["reserve"], _decimal(entry.get("targetAllocationWeight")))
        for entry in raw
        if entry.get("reserve") and _decimal(entry.get("targetAllocationWeight")) > 0
    ]
    total = sum((weight for _, weight in live), Decimal(0))
    return tuple(
        Allocation(
            reserve=reserve,
            market=index.reserve_markets.get(reserve, ""),
            market_name=index.market_names.get(index.reserve_markets.get(reserve, ""), ""),
            token_symbol=index.reserve_tokens.get(reserve, "?"),
            weight_pct=(weight / total * 100) if total else Decimal(0),
        )
        for reserve, weight in live
    )


def _min_deposit(raw: object, decimals: object) -> Decimal | None:
    """Scaled into whole tokens, or None when the scale is unknown."""
    amount = to_decimal(raw, None)
    if amount is None or amount < 0 or not isinstance(decimals, int):
        return None
    return amount / (Decimal(10) ** decimals)


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None
