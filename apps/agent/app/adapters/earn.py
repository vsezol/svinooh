"""The earn catalog (apps/earn), read over HTTP.

The same seam as the portfolio API: a protocol in the agent's words, an adapter
that names the vendor, and a wire that stops here. No caller token — a catalog
of pools is public.
"""

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict

from ..domain.earn import CatalogSnapshot, YieldPool


class YieldCatalog(Protocol):
    """What the agent needs of a yield catalog."""

    async def best_pools(self, token: str | None, limit: int) -> CatalogSnapshot:
        """The best-paying pools for a token, or across every token."""


class EarnApiSource:
    """The svinooh earn service."""

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


def _number(raw: str | None) -> Decimal:
    """A decimal string from the wire; an unreadable one is zero, not a crash."""
    try:
        return Decimal(raw) if raw else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


class _WirePart(BaseModel):
    """Read what we use, ignore what we do not — a new field upstream is not an error."""

    model_config = ConfigDict(extra="ignore")


class _WireToken(_WirePart):
    symbol: str


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
            token=self.token.symbol,
            apy_net=_number(self.apy.net),
            apy_base=_number(self.apy.base),
            apy_rewards=_number(self.apy.rewards),
            apy_incentives=_number(self.apy.incentives),
            tvl_usd=_number(self.tvl_usd),
            url=self.url,
        )


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
