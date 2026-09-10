"""Where the agent's facts come from — and the seam that keeps it independent.

The agent consumes products through their public APIs, with the caller's own
token, exactly like any third-party client would (see DESIGN.md). Each product
is one DataSource behind this protocol; the portfolio is simply the first. No
shared libraries, no database access — if the public API cannot answer
something the agent needs, the fix is to extend the public API.

`token` is the caller's Authorization header value, passed through verbatim:
the agent holds no credentials of its own, so it can never read more than the
person asking.

What comes back is the domain's types, never the wire's: app/adapters/wire.py
does the translation, and nothing above this module has seen a dict since.
"""

from typing import Protocol

import httpx

from ..domain.portfolio import History, Me, Portfolio
from . import wire


class DataSource(Protocol):
    async def portfolio(self, ref: str, token: str | None) -> Portfolio: ...

    async def history(self, ref: str, range_: str, token: str | None) -> History: ...


class PortfolioApiSource:
    """The svinooh portfolio API, spoken to over plain public HTTP."""

    def __init__(self, base_url: str, timeout_s: float) -> None:
        self._base = base_url.rstrip("/")
        self._timeout_s = timeout_s

    @staticmethod
    def _headers(token: str | None) -> dict:
        # An absent token is an absent header, not a header with nothing in it:
        # the caller is simply anonymous, and the API answers what anonymous
        # callers may see.
        return {"authorization": token} if token else {}

    async def _get(self, path: str, token: str | None) -> object:
        # A client per call is deliberate at this traffic (one fetch per chat
        # turn); a pooled client is an optimization to make when it shows up in
        # a profile, not before.
        async with httpx.AsyncClient(timeout=self._timeout_s) as client:
            response = await client.get(f"{self._base}{path}", headers=self._headers(token))
            response.raise_for_status()
            return response.json()

    async def _post(self, path: str, token: str | None, body: dict) -> object:
        async with httpx.AsyncClient(timeout=self._timeout_s) as client:
            response = await client.post(
                f"{self._base}{path}", headers=self._headers(token), json=body
            )
            response.raise_for_status()
            return response.json()

    async def me(self, token: str) -> Me:
        # The host's identity oracle (DESIGN.md, one identity, two doors): one
        # call answers both "whose token is this" and "which portfolios do they
        # own". Host-specific on purpose — it is NOT part of the DataSource
        # protocol, because identity belongs to the host product, while the
        # protocol is only what every data source must answer.
        return wire.me(await self._get("/api/auth/me", token))

    async def create_portfolio(self, token: str | None) -> str:
        # The agent's writes go through the same public API as its reads, with
        # the same caller's token — so what the agent creates lands owned by
        # the person asking, and nothing the agent can do exceeds what they
        # could click themselves. Answers with the new portfolio's slug.
        return wire.slug(await self._post("/api/portfolios", token, {}))

    async def create_anonymous_portfolio(self, address: str) -> str:
        # The ownerless door, and the reason a visitor never meets a sign-in
        # wall: this POST takes no token and returns a portfolio that belongs
        # to nobody, claimable by an account later. It is find-or-CREATE on the
        # address, so a second visitor pasting the same wallet lands on the
        # same portfolio rather than a duplicate of it.
        return wire.slug(await self._post("/api/portfolios/anonymous", None, {"address": address}))

    async def add_wallet(self, slug: str, address: str, token: str | None) -> None:
        # Optional auth on the host side: an ownerless portfolio accepts a
        # wallet from anyone, an owned one only from its owner. Passing None is
        # therefore meaningful rather than a missing argument.
        await self._post(f"/api/portfolios/{slug}/wallets", token, {"address": address})

    async def portfolio(self, ref: str, token: str | None) -> Portfolio:
        return wire.portfolio(await self._get(f"/api/portfolios/{ref}", token))

    async def history(self, ref: str, range_: str, token: str | None) -> History:
        # range_ is the product's own HistoryRange: 1h | 24h | 7d | 30d | all —
        # the same values the charts use.
        return wire.history(await self._get(f"/api/portfolios/{ref}/history?range={range_}", token))
