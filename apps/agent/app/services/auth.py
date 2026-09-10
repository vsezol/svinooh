"""Who is asking — the token validated against the host, never decoded here.

The agent shares no JWT_SECRET: the only authority on a token is the host
API, so validation is one cached question, GET /auth/me with the caller's
token. Two failure modes, deliberately opposite. The host REJECTS the token
(401/403): that is an answer, and the caller gets 401. The host CANNOT answer
(down, timing out): the caller is treated as anonymous rather than turned
away. Safe by construction, because this gate only names callers; the host
checks the same token on every read and write regardless.

The cache keys by token digest, so a memory dump names nobody's credentials.
"""

import hashlib
import logging
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException

from ..adapters.portfolio import PortfolioApiSource

logger = logging.getLogger("svinooh-ai")


@dataclass(frozen=True)
class Caller:
    user_id: str


class Authenticator:
    """Names a caller from their token, asking the host and remembering briefly."""

    def __init__(self, portfolio: PortfolioApiSource, ttl_s: int) -> None:
        self._portfolio = portfolio
        # Short on purpose: a validation only names the caller; data calls
        # always carry the live token to the host.
        self._ttl_s = ttl_s
        # token digest -> (expires at, caller)
        self._cache: dict[str, tuple[float, Caller]] = {}

    async def authenticate(self, token: str | None) -> Caller | None:
        """Name the caller, or None for the anonymous.

        Raises 401 only when the host affirmatively rejects the token.
        """
        if not token:
            return None
        self._evict()
        key = hashlib.sha256(token.encode()).hexdigest()
        cached = self._cache.get(key)
        if cached and cached[0] > time.time():
            return cached[1]

        try:
            me = await self._portfolio.me(token)
        except httpx.HTTPStatusError as error:
            if error.response.status_code in (401, 403):
                raise HTTPException(status_code=401, detail="unknown token") from error
            logger.warning("auth check errored (%s) — treating caller as anonymous", error)
            return None
        except Exception as error:  # noqa: BLE001 — an outage must not close the door
            logger.warning("auth check failed (%r) — treating caller as anonymous", error)
            return None

        caller = Caller(user_id=me.user_id)
        self._cache[key] = (time.time() + self._ttl_s, caller)
        return caller

    def _evict(self) -> None:
        now = time.time()
        for key in [key for key, (expires, _) in self._cache.items() if expires < now]:
            del self._cache[key]
