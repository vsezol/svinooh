"""Kamino's public API: the calls, and the shapes they answer with.

No key, no RPC node, no wallet — Kamino has already read the chain:

    GET /kvaults/vaults                           the vaults and their on-chain state
    GET /kvaults/vaults/metrics                   every vault's rates, 100 per page
    GET /v2/kamino-market                         the 41 lending markets
    GET /kamino-market/{market}/reserves/metrics  per market

The payload types are `total=False` because they are somebody else's JSON:
every key is optional until proven otherwise, and pretending a field is
guaranteed is how a missing one becomes a 500 at three in the morning.
"""
from __future__ import annotations

from typing import Any, TypedDict, cast

from earn.infrastructure.http import JsonTransport, gather_successful


class AllocationPayload(TypedDict, total=False):
    reserve: str
    targetAllocationWeight: int


class VaultStatePayload(TypedDict, total=False):
    name: str
    tokenMint: str
    tokenMintDecimals: int
    tokenProgram: str
    sharesMint: str
    sharesMintDecimals: int
    performanceFeeBps: int
    managementFeeBps: int
    minDepositAmount: str
    vaultAllocationStrategy: list[AllocationPayload]


class VaultPayload(TypedDict, total=False):
    address: str
    programId: str
    state: VaultStatePayload


class VaultMetricsPayload(TypedDict, total=False):
    kvault: str
    apy: str
    apyFarmRewards: str
    apyIncentives: str
    apyReservesIncentives: str
    apy24h: str
    apy7d: str
    apy30d: str
    apy90d: str
    apy365d: str
    tokensAvailable: str
    tokensAvailableUsd: str
    tokensInvested: str
    tokensInvestedUsd: str
    numberOfHolders: int


class MarketPayload(TypedDict, total=False):
    name: str
    lendingMarket: str


class ReserveMetricsPayload(TypedDict, total=False):
    reserve: str
    liquidityToken: str
    liquidityTokenMint: str
    supplyApy: str
    borrowApy: str
    totalSupply: str
    totalBorrow: str
    totalSupplyUsd: str


class MarketReserves(TypedDict):
    market: str
    name: str
    reserves: list[ReserveMetricsPayload]


#: A guard, not a limit: the metrics endpoint pages with an opaque token, and an
#: upstream that kept handing one back would otherwise loop inside a refresh.
MAX_METRIC_PAGES = 20


class KaminoApi:
    def __init__(self, api: JsonTransport) -> None:
        self._api = api

    async def vaults(self) -> list[VaultPayload]:
        return cast(list[VaultPayload], await self._api.get("/kvaults/vaults"))

    async def vault_metrics(self) -> dict[str, VaultMetricsPayload]:
        """Every vault's rates, keyed by vault address.

        One call per hundred vaults rather than one per vault: the batch
        endpoint carries the address in `kvault`, which is the join key.
        Asking 178 vaults separately would be 178 requests for one answer.
        """
        by_vault: dict[str, VaultMetricsPayload] = {}
        token: str | None = None
        for _ in range(MAX_METRIC_PAGES):
            page: dict[str, Any] = await self._api.get(
                "/kvaults/vaults/metrics", paginationToken=token
            )
            for entry in cast(list[VaultMetricsPayload], page.get("result") or []):
                address = entry.get("kvault")
                if address:
                    by_vault[address] = entry
            token = page.get("paginationToken")
            if not token:
                break
        return by_vault

    async def markets(self) -> list[MarketPayload]:
        return cast(list[MarketPayload], await self._api.get("/v2/kamino-market"))

    async def reserves_by_market(self, markets: list[MarketPayload]) -> list[MarketReserves]:
        """Every market's reserves, asked for concurrently and forgivingly.

        A market that cannot be read is skipped rather than failing the source:
        they are independent, and one of forty-one being unreachable should not
        cost us the other forty.
        """

        async def one(market: MarketPayload) -> MarketReserves:
            address = market["lendingMarket"]
            reserves = cast(
                list[ReserveMetricsPayload],
                await self._api.get(f"/kamino-market/{address}/reserves/metrics"),
            )
            return MarketReserves(
                market=address,
                name=market.get("name") or f"Market {address[:8]}",
                reserves=reserves or [],
            )

        return await gather_successful(
            [market for market in markets if market.get("lendingMarket")],
            one,
            label="kamino reserves",
        )
