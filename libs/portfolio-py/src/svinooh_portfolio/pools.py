from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict


class PoolCatalog:
    """The earn service's catalog of lending pools, read over its public API."""

    def __init__(self, base_url: str, client: httpx.AsyncClient) -> None:
        self._base = base_url.rstrip("/")
        self._client = client

    async def best_pools(self, token: str | None, limit: int) -> "CatalogSnapshot":
        params: dict[str, str | int] = {"sort": "-apy", "limit": limit}
        if token:
            params["token"] = token
        response = await self._client.get(f"{self._base}/v1/lend/pools", params=params)
        response.raise_for_status()
        return CatalogAnswer.model_validate(response.json()).domain()


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
class CatalogSnapshot:
    pools: tuple[YieldPool, ...]
    as_of: datetime | None = None
    stale: bool = False


def number(raw: str | None) -> Decimal:
    try:
        return Decimal(raw) if raw else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


class Wire(BaseModel):
    model_config = ConfigDict(extra="ignore")


class TokenWire(Wire):
    symbol: str
    mint: str = ""
    decimals: int | None = None


class ApyWire(Wire):
    net: str
    base: str
    rewards: str
    incentives: str = "0"


class PoolWire(Wire):
    id: str
    name: str
    protocol: str
    kind: str
    network: str = ""
    token: TokenWire
    apy: ApyWire
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
            apy_net=number(self.apy.net),
            apy_base=number(self.apy.base),
            apy_rewards=number(self.apy.rewards),
            apy_incentives=number(self.apy.incentives),
            tvl_usd=number(self.tvl_usd),
            url=self.url,
        )


class DepositWire(Wire):
    program_id: str
    address: str
    min_amount: str | None = None
    shares_mint: str | None = None
    shares_decimals: int | None = None
    token_program: str | None = None
    lending_market: str | None = None


class PoolDetailWire(PoolWire):
    deposit: DepositWire

    def domain(self) -> YieldPool:
        pool = super().domain()
        return replace(
            pool,
            terms=DepositTerms(
                program_id=self.deposit.program_id,
                address=self.deposit.address,
                token_mint=self.token.mint,
                token_decimals=self.token.decimals,
                min_amount=number(self.deposit.min_amount) or None,
                shares_mint=self.deposit.shares_mint,
                shares_decimals=self.deposit.shares_decimals,
                token_program=self.deposit.token_program,
                lending_market=self.deposit.lending_market,
            ),
        )


class PoolAnswer(Wire):
    data: PoolDetailWire

    def domain(self) -> YieldPool:
        return self.data.domain()


class MetaWire(Wire):
    as_of: datetime | None = None
    stale: bool = False


class CatalogAnswer(Wire):
    data: list[PoolWire]
    meta: MetaWire = MetaWire()

    def domain(self) -> CatalogSnapshot:
        return CatalogSnapshot(
            pools=tuple(pool.domain() for pool in self.data),
            as_of=self.meta.as_of,
            stale=self.meta.stale,
        )
