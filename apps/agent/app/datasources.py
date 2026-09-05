"""Where the agent's facts come from — and the seam that keeps it independent.

The agent consumes products through their public APIs, with the caller's own
token, exactly like any third-party client would (DESIGN.md, D1/D2). Each
product is one DataSource behind this protocol; the portfolio is simply the
first. No shared libraries, no database access — if the public API cannot
answer something the agent needs, the fix is to extend the public API.

`token` is the caller's Authorization header value, passed through verbatim:
the agent holds no credentials of its own, so it can never read more than the
person asking.
"""
from typing import Protocol

import httpx

from .config import settings


class DataSource(Protocol):
    async def portfolio(self, ref: str, token: str) -> dict: ...

    async def history(self, ref: str, range_: str, token: str) -> dict: ...


class PortfolioApiSource:
    """The svinooh portfolio API, spoken to over plain public HTTP."""

    def __init__(self, base_url: str):
        self._base = base_url.rstrip("/")

    async def _get(self, path: str, token: str) -> dict:
        # A client per call is deliberate at this traffic (one fetch per chat
        # turn); a pooled client is an optimization to make when it shows up in
        # a profile, not before.
        async with httpx.AsyncClient(timeout=settings.context_timeout_s) as client:
            response = await client.get(f"{self._base}{path}", headers={"authorization": token})
            response.raise_for_status()
            return response.json()

    async def portfolio(self, ref: str, token: str) -> dict:
        return await self._get(f"/api/portfolios/{ref}", token)

    async def history(self, ref: str, range_: str, token: str) -> dict:
        return await self._get(f"/api/portfolios/{ref}/history?range={range_}", token)
