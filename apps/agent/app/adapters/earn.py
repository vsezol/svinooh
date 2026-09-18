"""The earn catalog: where a token can be put to work, read over HTTP.

The second neighbour, and the same seam as the first (app/adapters/portfolio.py):
a protocol written in the application's words, an adapter that names the
vendor, and a wire that stops here. No credentials — the catalog is public
facts about pools, so unlike the portfolio API there is no token to pass on.

The wire models live in this module rather than in wire.py because that module
is the HOST's JSON — camelCase, the portfolio's shapes. This one is another
service with another dialect: snake_case, and every number a string. Two
neighbours, two translations, neither pretending to be the other.
"""

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Protocol

import httpx
from pydantic import BaseModel, ConfigDict

from ..domain.earn import Listing, Option


class YieldCatalog(Protocol):
    """What the agent needs of a yield catalog, in the agent's words."""

    async def options(self, token: str | None, limit: int) -> Listing:
        """The best-paying places for a token, or across every token."""


def _decimal(raw: str | None) -> Decimal:
    """A string from the wire as a number, and a bad one as zero rather than a crash.

    The catalog promises decimal strings; a pool whose rate arrived unreadable
    is still a pool worth naming, and zero is the one wrong answer that cannot
    talk somebody into a deposit.
    """
    try:
        return Decimal(raw) if raw else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


class _Token(BaseModel):
    model_config = ConfigDict(extra="ignore")

    symbol: str


class _Apy(BaseModel):
    model_config = ConfigDict(extra="ignore")

    net: str
    base: str
    rewards: str
    incentives: str = "0"


class _Pool(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    protocol: str
    kind: str
    token: _Token
    apy: _Apy
    tvl_usd: str
    url: str

    def domain(self) -> Option:
        return Option(
            id=self.id,
            name=self.name,
            protocol=self.protocol,
            kind=self.kind,
            token=self.token.symbol,
            apy_net=_decimal(self.apy.net),
            apy_base=_decimal(self.apy.base),
            apy_rewards=_decimal(self.apy.rewards),
            apy_incentives=_decimal(self.apy.incentives),
            tvl_usd=_decimal(self.tvl_usd),
            url=self.url,
        )


class _Meta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    as_of: datetime | None = None
    stale: bool = False


class _Answer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    data: list[_Pool]
    meta: _Meta = _Meta()

    def domain(self) -> Listing:
        return Listing(
            options=tuple(pool.domain() for pool in self.data),
            as_of=self.meta.as_of,
            stale=self.meta.stale,
        )


class EarnApiSource:
    """The svinooh earn service, spoken to over its public wire."""

    def __init__(self, base_url: str, client: httpx.AsyncClient) -> None:
        self._base = base_url.rstrip("/")
        self._client = client

    async def options(self, token: str | None, limit: int) -> Listing:
        # Sorted by rate at the source: ranking is the catalog's job, and
        # asking for twenty of the best is one request rather than a page walk.
        params: dict[str, str | int] = {"sort": "-apy", "limit": limit}
        if token:
            params["token"] = token
        response = await self._client.get(f"{self._base}/v1/lend/pools", params=params)
        response.raise_for_status()
        return _Answer.model_validate(response.json()).domain()
