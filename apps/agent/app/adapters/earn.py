from dataclasses import replace
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict

from ..domain.earn import (
    CatalogSnapshot,
    Coin,
    DepositTerms,
    Held,
    LiquidityPosition,
    PairPool,
    YieldPool,
)


class YieldCatalog(Protocol):
    async def best_pools(self, token: str | None, limit: int) -> CatalogSnapshot:
        """The best-paying pools for a token, or across every token."""

    async def pool(self, pool_id: str) -> YieldPool | None: ...

    async def positions(self, owner: str) -> tuple[Held, ...]: ...

    async def coin(self, query: str, owners: tuple[str, ...]) -> Coin | None:
        """The coin a ticker or a mint names, looked for first among what these wallets hold."""

    async def pair_pools(
        self, first: str, second: str, below_pct: Decimal | None, above_pct: Decimal | None
    ) -> tuple[PairPool, ...]:
        """Pools pairing two tokens, most money first; with a range, whether each holds it."""

    async def pair_pool(self, pool_id: str) -> PairPool | None: ...

    async def liquidity_positions(self, owner: str) -> tuple[LiquidityPosition, ...]: ...

    async def held_now(self, owner: str, coin: str) -> Decimal | None: ...


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

    async def pair_pools(
        self, first: str, second: str, below_pct: Decimal | None, above_pct: Decimal | None
    ) -> tuple[PairPool, ...]:
        params: dict[str, str] = {"network": "sol", "pair": f"{first}-{second}"}
        if below_pct is not None and above_pct is not None:
            params |= {"below_pct": f"{below_pct:f}", "above_pct": f"{above_pct:f}"}
        response = await self._client.get(f"{self._base}/v1/liquidity/pools", params=params)
        if response.status_code == 422:
            return ()
        response.raise_for_status()
        return tuple(
            pool.domain() for pool in _PairPoolsAnswer.model_validate(response.json()).data
        )

    async def pair_pool(self, pool_id: str) -> PairPool | None:
        response = await self._client.get(f"{self._base}/v1/liquidity/pools/{pool_id}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return _PairPoolAnswer.model_validate(response.json()).data.domain()

    async def liquidity_positions(self, owner: str) -> tuple[LiquidityPosition, ...]:
        response = await self._client.get(
            f"{self._base}/v1/liquidity/positions", params={"network": "sol", "owner": owner}
        )
        response.raise_for_status()
        return tuple(
            one.domain() for one in _LiquidityPositionsAnswer.model_validate(response.json()).data
        )

    async def coin(self, query: str, owners: tuple[str, ...]) -> Coin | None:
        response = await self._client.get(
            f"{self._base}/v1/lend/coins",
            params={"network": "sol", "q": query, "owner": list(owners)},
        )
        if response.status_code in (404, 422):
            return None
        response.raise_for_status()
        return _CoinAnswer.model_validate(response.json()).domain()

    async def held_now(self, owner: str, coin: str) -> Decimal | None:
        response = await self._client.get(
            f"{self._base}/v1/lend/holdings",
            params={"network": "sol", "q": coin, "owner": owner},
        )
        if response.status_code in (404, 422):
            return None
        response.raise_for_status()
        amount = _HoldingAnswer.model_validate(response.json()).data.amount
        return None if amount is None else _number(amount)


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
    shares: str | None = None

    def domain(self) -> Held:
        return Held(
            pool=self.pool.domain(),
            amount=_number(self.amount),
            shares=_number(self.shares) if self.shares else None,
        )


class _PositionsAnswer(_WirePart):
    data: list[_WireHeld]

    def domain(self) -> tuple[Held, ...]:
        return tuple(held.domain() for held in self.data)


class _WireCoin(_WirePart):
    symbol: str
    mint: str
    decimals: int


class _CoinAnswer(_WirePart):
    data: _WireCoin

    def domain(self) -> Coin:
        return Coin(symbol=self.data.symbol, mint=self.data.mint, decimals=self.data.decimals)


class _WireHolding(_WirePart):
    amount: str | None


class _HoldingAnswer(_WirePart):
    data: _WireHolding


class _WirePairToken(_WirePart):
    symbol: str
    mint: str


class _WirePairPool(_WirePart):
    id: str
    name: str
    x: _WirePairToken
    y: _WirePairToken
    bin_step: int
    fee_apr: str
    tvl_usd: str
    price: str
    url: str
    range_bins: int | None = None
    why_not: str | None = None

    def domain(self) -> PairPool:
        return PairPool(
            id=self.id,
            name=self.name,
            x=self.x.symbol,
            y=self.y.symbol,
            x_mint=self.x.mint,
            y_mint=self.y.mint,
            bin_step=self.bin_step,
            fee_apr=_number(self.fee_apr),
            tvl_usd=_number(self.tvl_usd),
            price=_number(self.price),
            url=self.url,
            range_bins=self.range_bins,
            why_not=self.why_not,
        )


class _PairPoolsAnswer(_WirePart):
    data: list[_WirePairPool]


class _PairPoolAnswer(_WirePart):
    data: _WirePairPool


class _WireLiquidityPosition(_WirePart):
    address: str
    pool: _WirePairPool
    lower_price: str
    upper_price: str
    in_range: bool
    amount_x: str
    amount_y: str
    value_usd: str
    fees_usd: str = "0"

    def domain(self) -> LiquidityPosition:
        return LiquidityPosition(
            address=self.address,
            pool=self.pool.domain(),
            lower_price=_number(self.lower_price),
            upper_price=_number(self.upper_price),
            in_range=self.in_range,
            amount_x=_number(self.amount_x),
            amount_y=_number(self.amount_y),
            value_usd=_number(self.value_usd),
            fees_usd=_number(self.fees_usd),
        )


class _LiquidityPositionsAnswer(_WirePart):
    data: list[_WireLiquidityPosition]
