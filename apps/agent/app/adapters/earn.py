from dataclasses import replace
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict

from ..domain.earn import CatalogSnapshot, DepositTerms, Held, YieldPool


class YieldCatalog(Protocol):
    async def best_pools(self, token: str | None, limit: int) -> CatalogSnapshot:
        """The best-paying pools for a token, or across every token."""

    async def pool(self, pool_id: str) -> YieldPool | None: ...

    async def positions(self, owner: str) -> tuple[Held, ...]: ...


class EarnApiSource:
    def __init__(self, base_url: str, client: httpx.AsyncClient) -> None:
        self._base = base_url.rstrip("/")
        self._client = client

    async def best_pools(self, token: str | None, limit: int) -> CatalogSnapshot:
        params: dict[str, str | int] = {"sort": "-apy", "limit": limit}
        if token:
            params["token"] = token
        response = await self._client.get(f"{self._base}/v1/lend/pools", params=params)
        response.raise_for_status()
        return _CatalogAnswer.model_validate(response.json()).domain()

    async def pool(self, pool_id: str) -> YieldPool | None:
        response = await self._client.get(f"{self._base}/v1/lend/pools/{pool_id}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return _PoolAnswer.model_validate(response.json()).domain()

    async def positions(self, owner: str) -> tuple[Held, ...]:
        response = await self._client.get(
            f"{self._base}/v1/lend/positions", params={"network": "sol", "owner": owner}
        )
        response.raise_for_status()
        return _PositionsAnswer.model_validate(response.json()).domain()


def _number(raw: str | None) -> Decimal:
    try:
        return Decimal(raw) if raw else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


class _WirePart(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _WireToken(_WirePart):
    symbol: str
    mint: str = ""
    decimals: int | None = None


class _WireApy(_WirePart):
    net: str
    base: str
    rewards: str
    incentives: str = "0"


class _WirePool(_WirePart):
    id: str
    name: str
    protocol: str
    kind: str
    network: str = ""
    token: _WireToken
    apy: _WireApy
    tvl_usd: str
    url: str

    def domain(self) -> YieldPool:
        return YieldPool(
            id=self.id,
            name=self.name,
            protocol=self.protocol,
            kind=self.kind,
            network=self.network,
            token=self.token.symbol,
            apy_net=_number(self.apy.net),
            apy_base=_number(self.apy.base),
            apy_rewards=_number(self.apy.rewards),
            apy_incentives=_number(self.apy.incentives),
            tvl_usd=_number(self.tvl_usd),
            url=self.url,
        )


class _WireDeposit(_WirePart):
    program_id: str
    address: str
    min_amount: str | None = None
    shares_mint: str | None = None
    shares_decimals: int | None = None
    token_program: str | None = None
    lending_market: str | None = None


class _WirePoolDetail(_WirePool):
    deposit: _WireDeposit

    def domain(self) -> YieldPool:
        pool = super().domain()
        return replace(
            pool,
            terms=DepositTerms(
                program_id=self.deposit.program_id,
                address=self.deposit.address,
                token_mint=self.token.mint,
                token_decimals=self.token.decimals,
                min_amount=_number(self.deposit.min_amount) or None,
                shares_mint=self.deposit.shares_mint,
                shares_decimals=self.deposit.shares_decimals,
                token_program=self.deposit.token_program,
                lending_market=self.deposit.lending_market,
            ),
        )


class _PoolAnswer(_WirePart):
    data: _WirePoolDetail

    def domain(self) -> YieldPool:
        return self.data.domain()


class _WireMeta(_WirePart):
    as_of: datetime | None = None
    stale: bool = False


class _CatalogAnswer(_WirePart):
    data: list[_WirePool]
    meta: _WireMeta = _WireMeta()

    def domain(self) -> CatalogSnapshot:
        return CatalogSnapshot(
            pools=tuple(pool.domain() for pool in self.data),
            as_of=self.meta.as_of,
            stale=self.meta.stale,
        )


class _WireHeld(_WirePart):
    pool: _WirePool
    amount: str

    def domain(self) -> Held:
        return Held(pool=self.pool.domain(), amount=_number(self.amount))


class _PositionsAnswer(_WirePart):
    data: list[_WireHeld]

    def domain(self) -> tuple[Held, ...]:
        return tuple(held.domain() for held in self.data)
