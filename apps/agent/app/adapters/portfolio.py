from typing import Protocol

import httpx

from ..domain.errors import UnknownTokenError
from ..domain.portfolio import History, Me, Portfolio
from . import wire


class DataSource(Protocol):
    async def portfolio(self, ref: str, token: str | None) -> Portfolio: ...

    async def history(self, ref: str, range_: str, token: str | None) -> History: ...


class PortfolioApiSource:
    def __init__(self, base_url: str, client: httpx.AsyncClient) -> None:
        self._base = base_url.rstrip("/")
        self._client = client

    @staticmethod
    def _headers(token: str | None) -> dict:
        return {"authorization": token} if token else {}

    async def _get(self, path: str, token: str | None) -> object:
        response = await self._client.get(f"{self._base}{path}", headers=self._headers(token))
        response.raise_for_status()
        return response.json()

    async def _post(self, path: str, token: str | None, body: dict) -> object:
        response = await self._client.post(
            f"{self._base}{path}", headers=self._headers(token), json=body
        )
        response.raise_for_status()
        return response.json()

    async def me(self, token: str) -> Me:
        try:
            payload = await self._get("/api/auth/me", token)
        except httpx.HTTPStatusError as error:
            if error.response.status_code in (401, 403):
                raise UnknownTokenError from error
            raise
        return wire.me(payload)

    async def create_portfolio(self, token: str | None) -> str:
        return wire.slug(await self._post("/api/portfolios", token, {}))

    async def create_anonymous_portfolio(self, address: str) -> str:
        return wire.slug(await self._post("/api/portfolios/anonymous", None, {"address": address}))

    async def add_wallet(self, slug: str, address: str, token: str | None) -> None:
        await self._post(f"/api/portfolios/{slug}/wallets", token, {"address": address})

    async def portfolio(self, ref: str, token: str | None) -> Portfolio:
        return wire.portfolio(await self._get(f"/api/portfolios/{ref}", token))

    async def history(self, ref: str, range_: str, token: str | None) -> History:
        return wire.history(await self._get(f"/api/portfolios/{ref}/history?range={range_}", token))
