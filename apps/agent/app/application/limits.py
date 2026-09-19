import logging
import time

from limits import RateLimitItemPerSecond
from limits.aio.strategies import MovingWindowRateLimiter

logger = logging.getLogger("svinooh-ai")


class WindowRateLimiter:
    def __init__(self, max_requests: int, window_s: int, storage):
        self._item = RateLimitItemPerSecond(max_requests, window_s)
        self._strategy = MovingWindowRateLimiter(storage)

    async def retry_after(self, key: str) -> int | None:
        try:
            if await self._strategy.hit(self._item, key):
                return None
            stats = await self._strategy.get_window_stats(self._item, key)
            return max(1, int(stats.reset_time - time.time()))
        except Exception as error:  # noqa: BLE001 — see the docstring
            logger.warning("rate limit storage failed (%r) — allowing the turn", error)
            return None


class WindowAllowance:
    def __init__(self, max_questions: int, window_s: int, storage):
        self._item = RateLimitItemPerSecond(max_questions, window_s)
        self._strategy = MovingWindowRateLimiter(storage)

    async def charge(self, key: str) -> bool:
        try:
            return await self._strategy.hit(self._item, key)
        except Exception as error:  # noqa: BLE001 — see the class docstring
            logger.warning("allowance storage failed (%r) — letting the question through", error)
            return True
