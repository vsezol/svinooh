import hashlib
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass

from svinooh_portfolio.source import PortfolioApiSource, UnknownTokenError

logger = logging.getLogger("svinooh-ai")


@dataclass(frozen=True)
class Caller:
    user_id: str


class Authenticator:
    def __init__(self, portfolio: PortfolioApiSource, ttl_s: int, max_entries: int) -> None:
        self._portfolio = portfolio
        self._ttl_s = ttl_s
        self._max_entries = max_entries
        self._cache: OrderedDict[str, tuple[float, Caller]] = OrderedDict()

    async def authenticate(self, token: str | None) -> Caller | None:
        if not token:
            return None
        self._evict()
        key = hashlib.sha256(token.encode()).hexdigest()
        cached = self._cache.get(key)
        if cached and cached[0] > time.time():
            return cached[1]

        try:
            me = await self._portfolio.me(token)
        except UnknownTokenError:
            raise
        except Exception as error:  # noqa: BLE001 — an outage must not close the door
            logger.warning("auth check failed (%r) — treating caller as anonymous", error)
            return None

        caller = Caller(user_id=me.user_id)
        self._cache[key] = (time.time() + self._ttl_s, caller)
        while len(self._cache) > self._max_entries:
            self._cache.popitem(last=False)
        return caller

    def _evict(self) -> None:
        now = time.time()
        for key in [key for key, (expires, _) in self._cache.items() if expires < now]:
            del self._cache[key]
