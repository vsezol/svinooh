from decimal import Decimal
from typing import Protocol

import httpx
from pydantic import Field
from svinooh_portfolio.pools import PoolAnswer, PoolWire, Wire, YieldPool, number

from ..domain.earn import Coin, Held, LiquidityPosition, PairPool


class YieldCatalog(Protocol):
    async def pool(self, pool_id: str) -> YieldPool | None: ...

    async def positions(self, owner: str) -> tuple[Held, ...]: ...

    async def coin(self, query: str, owners: tuple[str, ...]) -> Coin | None:
        """The coin a ticker or a mint names, looked for first among what these wallets hold."""

    async def pair_pools(
        self,
        first: str,
        second: str,
        below_pct: Decimal | None,
        above_pct: Decimal | None,
        near_pct: Decimal | None = None,
    ) -> tuple[PairPool, ...]:
        """Pools pairing two tokens, most money first; with a range, whether each holds it."""

    async def pair_pool(self, pool_id: str) -> PairPool | None: ...

    async def liquidity_positions(self, owner: str) -> tuple[LiquidityPosition, ...]: ...

    async def held_now(self, owner: str, coin: str) -> Decimal | None: ...

    async def opened_by(self, signature: str, owner: str) -> tuple[str, ...]:
        """The liquidity positions a landed transaction of this owner's named: the one it opened."""


class EarnApiSource:
    def __init__(self, base_url: str, client: httpx.AsyncClient) -> None:
        self._base = base_url.rstrip("/")
        self._client = client

    async def pool(self, pool_id: str) -> YieldPool | None:
        response = await self._client.get(f"{self._base}/v1/lend/pools/{pool_id}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return PoolAnswer.model_validate(response.json()).domain()

    async def positions(self, owner: str) -> tuple[Held, ...]:
        response = await self._client.get(
            f"{self._base}/v1/lend/positions", params={"network": "sol", "owner": owner}
        )
        response.raise_for_status()
        return _PositionsAnswer.model_validate(response.json()).domain()

    async def pair_pools(
        self,
        first: str,
        second: str,
        below_pct: Decimal | None,
        above_pct: Decimal | None,
        near_pct: Decimal | None = None,
    ) -> tuple[PairPool, ...]:
        params: dict[str, str] = {"network": "sol", "pair": f"{first}-{second}"}
        if below_pct is not None and above_pct is not None:
            params |= {"below_pct": f"{below_pct:f}", "above_pct": f"{above_pct:f}"}
        if near_pct is not None:
            params |= {"active_pct": f"{near_pct:f}"}
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
        return None if amount is None else number(amount)

    async def opened_by(self, signature: str, owner: str) -> tuple[str, ...]:
        response = await self._client.get(
            f"{self._base}/v1/lend/deposits/{signature}/effects",
            params={"network": "sol", "owner": owner},
        )
        if response.status_code in (404, 422):
            return ()
        response.raise_for_status()
        found = _EffectsAnswer.model_validate(response.json()).data
        if found is None:
            return ()
        return tuple(one.address for pair in found.pairs for one in pair.positions if one.touched)


class _WireHeld(Wire):
    pool: PoolWire
    amount: str
    shares: str | None = None

    def domain(self) -> Held:
        return Held(
            pool=self.pool.domain(),
            amount=number(self.amount),
            shares=number(self.shares) if self.shares else None,
        )


class _PositionsAnswer(Wire):
    data: list[_WireHeld]

    def domain(self) -> tuple[Held, ...]:
        return tuple(held.domain() for held in self.data)


class _WireCoin(Wire):
    symbol: str
    mint: str
    decimals: int


class _CoinAnswer(Wire):
    data: _WireCoin

    def domain(self) -> Coin:
        return Coin(symbol=self.data.symbol, mint=self.data.mint, decimals=self.data.decimals)


class _WireHolding(Wire):
    amount: str | None


class _HoldingAnswer(Wire):
    data: _WireHolding


class _WirePairToken(Wire):
    symbol: str
    mint: str


class _WirePairPool(Wire):
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
    active_usd: str | None = None
    fee_active: str | None = None

    def domain(self) -> PairPool:
        return PairPool(
            id=self.id,
            name=self.name,
            x=self.x.symbol,
            y=self.y.symbol,
            x_mint=self.x.mint,
            y_mint=self.y.mint,
            bin_step=self.bin_step,
            fee_apr=number(self.fee_apr),
            tvl_usd=number(self.tvl_usd),
            price=number(self.price),
            url=self.url,
            range_bins=self.range_bins,
            why_not=self.why_not,
            active_usd=None if self.active_usd is None else number(self.active_usd),
            fee_active=None if self.fee_active is None else number(self.fee_active),
        )


class _PairPoolsAnswer(Wire):
    data: list[_WirePairPool]


class _PairPoolAnswer(Wire):
    data: _WirePairPool


class _WireLiquidityPosition(Wire):
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
            lower_price=number(self.lower_price),
            upper_price=number(self.upper_price),
            in_range=self.in_range,
            amount_x=number(self.amount_x),
            amount_y=number(self.amount_y),
            value_usd=number(self.value_usd),
            fees_usd=number(self.fees_usd),
        )


class _LiquidityPositionsAnswer(Wire):
    data: list[_WireLiquidityPosition]


class _WireTouched(Wire):
    address: str
    touched: bool = False


class _WirePairAfter(Wire):
    positions: list[_WireTouched] = Field(default_factory=list)


class _WireEffects(Wire):
    pairs: list[_WirePairAfter] = Field(default_factory=list)


class _EffectsAnswer(Wire):
    data: _WireEffects | None = None
