"""How often one caller may ask — the cost lock on an LLM endpoint.

Every chat turn is a paid model call (several, when tools run), so the rate
limit is not etiquette here: it is the cap on what one caller can spend.

The counting is not ours: the `limits` library — the engine inside
flask-limiter and slowapi — provides the moving-window strategy and the
storage. Production rate limiting is a solved problem with sharp edges (window
arithmetic, races), so we buy the arithmetic and keep what is genuinely ours:
the KEY, a caller named by our auth gate rather than an IP. Memory storage
today, per instance and gone on restart — right for one process; the
multi-instance step is swapping in the library's Redis storage here, with no
caller changing.
"""
import time

from limits import RateLimitItemPerSecond
from limits.aio.storage import MemoryStorage
from limits.aio.strategies import MovingWindowRateLimiter


class RateLimiter:
    def __init__(self, max_requests: int, window_s: int):
        self._item = RateLimitItemPerSecond(max_requests, window_s)
        self._strategy = MovingWindowRateLimiter(MemoryStorage())

    async def retry_after(self, key: str) -> int | None:
        """Charge one attempt; None means allowed, a number is seconds to wait."""
        if await self._strategy.hit(self._item, key):
            return None
        stats = await self._strategy.get_window_stats(self._item, key)
        return max(1, int(stats.reset_time - time.time()))
