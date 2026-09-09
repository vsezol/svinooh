"""How often one caller may ask — the cost lock on an LLM endpoint.

Every chat turn is a paid model call (several, when tools run), so the rate
limit is not etiquette here: it is the cap on what one caller can spend.

The counting is not ours: the `limits` library — the engine inside
flask-limiter and slowapi — provides the moving-window strategy and the
storage. Production rate limiting is a solved problem with sharp edges (window
arithmetic, races), so we buy the arithmetic and keep what is genuinely ours:
the KEY, a caller named by our auth gate rather than an IP.

Storage is Redis when there is one, memory when there is not — the swap this
module's note has described from the start, made for the same reason the
conversation store made it and in the same commit. In-process counting is not
a smaller version of a rate limit across two instances; it is a rate limit
multiplied by however many replicas are running, which is the cost lock not
holding. The library's storage is the whole of the change: the key, the
window and every caller stay exactly as they were.
"""
import logging
import time

from limits import RateLimitItemPerSecond
from limits.aio.storage import MemoryStorage, RedisStorage
from limits.aio.strategies import MovingWindowRateLimiter

logger = logging.getLogger("svinooh-ai")

#: Keeps the limiter's counters out of the way of everything else on the
#: instance — the portfolio cache included. See app/store.py on sharing one.
KEY_PREFIX = "agent:rl"


def _storage(redis_url: str):
    """Shared counters when there is a Redis, per-process ones when there is not."""
    if not redis_url:
        logger.info("REDIS_URL not set — rate limiting is per-process")
        return MemoryStorage()
    # The library picks its client from the scheme, and its async Redis
    # storage speaks `async+redis://`. redis-py rather than the default
    # coredis, so this service has one Redis client library and not two.
    uri = redis_url if redis_url.startswith("async+") else f"async+{redis_url}"
    return RedisStorage(uri, implementation="redispy", key_prefix=KEY_PREFIX)


class RateLimiter:
    def __init__(self, max_requests: int, window_s: int, redis_url: str = ""):
        self._item = RateLimitItemPerSecond(max_requests, window_s)
        self._strategy = MovingWindowRateLimiter(_storage(redis_url))

    async def retry_after(self, key: str) -> int | None:
        """Charge one attempt; None means allowed, a number is seconds to wait.

        A storage that cannot answer lets the turn through. The limit is a cost
        lock, not a security boundary — refusing everybody because Redis blinked
        would turn a cache outage into an outage of the product, and the door
        that actually matters (the token, and the host API behind it) is not
        this one.
        """
        try:
            if await self._strategy.hit(self._item, key):
                return None
            stats = await self._strategy.get_window_stats(self._item, key)
            return max(1, int(stats.reset_time - time.time()))
        except Exception as error:  # noqa: BLE001 — see the docstring
            logger.warning("rate limit storage failed (%r) — allowing the turn", error)
            return None
