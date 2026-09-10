"""Kamino, on Solana: the two ways it pays you for one token.

**Vaults** (`kvaults`, what kamino.com/earn/lend shows) — you deposit a token,
you get a share token, and a curator spreads the deposit across lending
reserves. **Reserves** (`kamino-market`, kamino.com/borrow) — you supply
straight into one market's reserve and borrowers of that reserve pay you.

Same product to a depositor, different accounts to sign, so both normalise into
`Pool` and are told apart by `kind`.

The whole catalog costs three calls plus one per market:

    GET /kvaults/vaults                          the vaults and their on-chain state
    GET /kvaults/vaults/metrics                  every vault's rates, 100 per page
    GET /v2/kamino-market                        the 41 lending markets
    GET /kamino-market/{market}/reserves/metrics per market, when reserves are on

No key, no RPC node: Kamino's own API has already read the chain.
"""
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from ..config import settings
from ..domain import (
    Allocation,
    Apy,
    ApyWindows,
    DepositTerms,
    Fees,
    Liquidity,
    Pool,
    Token,
    dec,
    pool_id,
)
from ..http import Upstream, gather_limited

log = logging.getLogger("earn.kamino")


@dataclass(frozen=True)
class Index:
    """What one part of Kamino's API knows that another part needs.

    A vault names its token by mint address only, and names its allocations by
    reserve address only. Reserve metrics are where the ticker and the owning
    market are written down. Building this once per refresh is what lets a
    vault be described in words instead of base58.
    """

    #: mint -> ticker
    symbols: dict[str, str]
    #: lending market -> its display name
    market_names: dict[str, str]
    #: reserve -> the lending market it belongs to
    reserve_markets: dict[str, str]
    #: reserve -> the ticker it lends
    reserve_tokens: dict[str, str]

NETWORK = "sol"
PROTOCOL = "kamino"

#: Kamino's two on-chain programs. The vault list carries its own `programId`
#: per vault and that is what we use; this is the fallback for a payload that
#: omits it, and the constant for reserves, which the market API does not report.
KVAULT_PROGRAM = "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
KLEND_PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"

APP = "https://kamino.com"


async def _vault_metrics(kamino: Upstream) -> dict[str, dict[str, Any]]:
    """Every vault's rates, keyed by vault address.

    One call per 100 vaults rather than one call per vault: the batch endpoint
    pages with an opaque `paginationToken` and carries the vault address in
    `kvault`, which is the join key. Asking each of 178 vaults separately would
    be 178 requests for the same answer.
    """
    by_vault: dict[str, dict[str, Any]] = {}
    token: str | None = None
    # Bounded rather than `while True`: an upstream that kept handing back a
    # token would otherwise loop forever inside a refresh.
    for _ in range(20):
        page = await kamino.get_json("/kvaults/vaults/metrics", paginationToken=token)
        for entry in page.get("result") or []:
            address = entry.get("kvault")
            if address:
                by_vault[address] = entry
        token = page.get("paginationToken")
        if not token:
            break
    return by_vault


def _vault_pool(
    vault: dict[str, Any],
    metrics: dict[str, Any],
    index: "Index",
) -> Pool | None:
    state = vault.get("state") or {}
    address = vault.get("address")
    mint = state.get("tokenMint")
    if not address or not mint:
        return None

    invested_usd = dec(metrics.get("tokensInvestedUsd"))
    available_usd = dec(metrics.get("tokensAvailableUsd"))

    # `apy` is the base rate and excludes the reward programmes — checked
    # against the numbers on kamino.com: Sentora PYUSD shows 5.08% there, and
    # apy 2.575% + apyFarmRewards 2.504% is exactly that. Adding them here and
    # keeping the parts separate is what lets a caller show either.
    apy = Apy(
        base=dec(metrics.get("apy")),
        rewards=dec(metrics.get("apyFarmRewards")),
        incentives=dec(metrics.get("apyIncentives")) + dec(metrics.get("apyReservesIncentives")),
    )

    decimals = state.get("tokenMintDecimals")
    min_deposit_raw = dec(state.get("minDepositAmount"), Decimal(-1))
    scale = Decimal(10) ** int(decimals) if isinstance(decimals, int) else None
    min_deposit = min_deposit_raw / scale if scale and min_deposit_raw >= 0 else None

    allocations = []
    for entry in state.get("vaultAllocationStrategy") or []:
        reserve = entry.get("reserve")
        weight = dec(entry.get("targetAllocationWeight"))
        # Weight zero means the curator has moved off this reserve. It stays in
        # the on-chain strategy but it is not where the money is, and listing it
        # as an allocation would misdescribe the risk.
        if not reserve or weight <= 0:
            continue
        allocations.append((reserve, weight, entry))

    total_weight = sum((weight for _, weight, _ in allocations), Decimal(0))
    return Pool(
        id=pool_id(NETWORK, PROTOCOL, "vault", address),
        network=NETWORK,
        protocol=PROTOCOL,
        kind="vault",
        name=(state.get("name") or "").strip() or f"Kamino vault {address[:8]}",
        token=Token(
            symbol=index.symbols.get(mint) or "?",
            mint=mint,
            decimals=decimals if isinstance(decimals, int) else None,
        ),
        apy=apy,
        tvl_usd=invested_usd + available_usd,
        liquidity=Liquidity(
            deposited=dec(metrics.get("tokensInvested")) + dec(metrics.get("tokensAvailable")),
            deposited_usd=invested_usd + available_usd,
            available=dec(metrics.get("tokensAvailable")),
            available_usd=available_usd,
        ),
        deposit=DepositTerms(
            program_id=vault.get("programId") or KVAULT_PROGRAM,
            address=address,
            min_amount=min_deposit,
            shares_mint=state.get("sharesMint"),
            shares_decimals=state.get("sharesMintDecimals"),
            token_program=state.get("tokenProgram"),
        ),
        url=f"{APP}/earn/lend/{address}",
        apy_windows=ApyWindows(
            h24=dec(metrics.get("apy24h"), None),
            d7=dec(metrics.get("apy7d"), None),
            d30=dec(metrics.get("apy30d"), None),
            d90=dec(metrics.get("apy90d"), None),
            d365=dec(metrics.get("apy365d"), None),
        ),
        fees=Fees(
            performance_bps=int(state.get("performanceFeeBps") or 0),
            management_bps=int(state.get("managementFeeBps") or 0),
        ),
        holders=metrics.get("numberOfHolders") if isinstance(metrics.get("numberOfHolders"), int) else None,
        allocations=tuple(
            Allocation(
                reserve=reserve,
                market=index.reserve_markets.get(reserve, ""),
                market_name=index.market_names.get(index.reserve_markets.get(reserve, ""), ""),
                token_symbol=index.reserve_tokens.get(reserve, "?"),
                weight_pct=(weight / total_weight * 100) if total_weight else Decimal(0),
                amount=dec(entry.get("ctokenAllocation"), None),
            )
            for reserve, weight, entry in allocations
        ),
    )


def _reserve_pool(
    metric: dict[str, Any],
    market: str,
    market_name: str,
    decimals: dict[str, int],
) -> Pool | None:
    reserve = metric.get("reserve")
    mint = metric.get("liquidityTokenMint")
    if not reserve or not mint:
        return None

    supplied = dec(metric.get("totalSupply"))
    borrowed = dec(metric.get("totalBorrow"))
    symbol = (metric.get("liquidityToken") or "?").upper()
    return Pool(
        id=pool_id(NETWORK, PROTOCOL, "reserve", reserve),
        network=NETWORK,
        protocol=PROTOCOL,
        kind="reserve",
        name=f"{symbol} · {market_name}",
        token=Token(symbol=symbol, mint=mint, decimals=decimals.get(mint)),
        # A reserve's metrics report the rate borrowers pay for it and nothing
        # else. Reserve-level reward programmes exist and this endpoint does not
        # carry them, so rewards stay zero rather than being guessed at.
        apy=Apy(base=dec(metric.get("supplyApy"))),
        tvl_usd=dec(metric.get("totalSupplyUsd")),
        liquidity=Liquidity(
            deposited=supplied,
            deposited_usd=dec(metric.get("totalSupplyUsd")),
            available=supplied - borrowed,
            utilization=(borrowed / supplied) if supplied > 0 else Decimal(0),
        ),
        deposit=DepositTerms(
            program_id=KLEND_PROGRAM,
            address=reserve,
            lending_market=market,
        ),
        url=f"{APP}/borrow/reserve/{market}/{reserve}",
        borrow_apy=dec(metric.get("borrowApy")),
    )


async def fetch_pools(kamino: Upstream) -> list[Pool]:
    """Everything on Kamino that pays for a single-token deposit."""
    vaults: list[dict[str, Any]] = await kamino.get_json("/kvaults/vaults")
    metrics = await _vault_metrics(kamino)
    markets: list[dict[str, Any]] = await kamino.get_json("/v2/kamino-market")

    # Reserve metrics are read even when reserves are not listed as pools of
    # their own: they are the only place a mint's ticker is written down, and a
    # vault knows its token only by mint address.
    per_market = await gather_limited(
        [m for m in markets if m.get("lendingMarket")],
        lambda market: _market_reserves(kamino, market),
        label="kamino reserves",
    )

    symbols: dict[str, str] = {}
    decimals: dict[str, int] = {}
    reserve_markets: dict[str, str] = {}
    reserve_tokens: dict[str, str] = {}
    market_names: dict[str, str] = {}
    for market, name, reserves in per_market:
        market_names[market] = name
        for metric in reserves:
            mint = metric.get("liquidityTokenMint")
            reserve = metric.get("reserve")
            if mint and metric.get("liquidityToken"):
                symbols.setdefault(mint, metric["liquidityToken"].upper())
            if reserve:
                reserve_markets[reserve] = market
                reserve_tokens[reserve] = (metric.get("liquidityToken") or "?").upper()

    # Decimals are never reported for a reserve's token, but a vault states them
    # for its own mint — so every mint that has a vault gets them, and the rest
    # stay null rather than being assumed to be six.
    for vault in vaults:
        state = vault.get("state") or {}
        if state.get("tokenMint") and isinstance(state.get("tokenMintDecimals"), int):
            decimals.setdefault(state["tokenMint"], state["tokenMintDecimals"])

    index = Index(
        symbols=symbols,
        market_names=market_names,
        reserve_markets=reserve_markets,
        reserve_tokens=reserve_tokens,
    )

    pools: list[Pool] = []
    for vault in vaults:
        pool = _vault_pool(vault, metrics.get(vault.get("address") or "", {}), index)
        if pool:
            pools.append(pool)

    if settings.include_reserves:
        for market, name, reserves in per_market:
            for metric in reserves:
                pool = _reserve_pool(metric, market, name, decimals)
                if pool:
                    pools.append(pool)

    log.info(
        "kamino: %d vaults, %d markets, %d pools before filtering",
        len(vaults),
        len(per_market),
        len(pools),
    )
    return pools


async def _market_reserves(
    kamino: Upstream, market: dict[str, Any]
) -> tuple[str, str, list[dict[str, Any]]]:
    address = market["lendingMarket"]
    name = market.get("name") or f"Market {address[:8]}"
    reserves = await kamino.get_json(f"/kamino-market/{address}/reserves/metrics")
    return address, name, reserves or []
