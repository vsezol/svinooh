"""How often one caller may ask — the cost lock on an LLM endpoint.

Every chat turn is a paid model call (several, when tools run), so the rate
limit is not etiquette here: it is the cap on what one caller can spend.

What is ours is the KEY — a caller named by our auth gate rather than an IP —
and the decision to let a turn through when the counters cannot be reached.
The window arithmetic is bought from the `limits` library, and *where* the
counting happens is an adapter: app/adapters/redis/rate_limit.py shares the
instance, app/adapters/memory.py counts in this process. This class never
learns which it was given.
"""
import logging
import time

from limits import RateLimitItemPerSecond
from limits.aio.strategies import MovingWindowRateLimiter

logger = logging.getLogger("svinooh-ai")


class WindowRateLimiter:
    """ports.RateLimiter over a moving window.

    `storage` is one of the library's storage objects, handed in by the
    composition root — this class does not build one, which is what keeps the
    choice of Redis out of the service layer entirely.
    """

    def __init__(self, max_requests: int, window_s: int, storage):
        self._item = RateLimitItemPerSecond(max_requests, window_s)
        self._strategy = MovingWindowRateLimiter(storage)

    async def retry_after(self, key: str) -> int | None:
        """Charge one attempt; None means allowed, a number is seconds to wait.

        A storage that cannot answer lets the turn through. The limit is a cost
        lock, not a security boundary — refusing everybody because Redis
        blinked would turn a cache outage into an outage of the product, and
        the door that actually matters (the token, and the host API behind it)
        is not this one.
        """
        try:
            if await self._strategy.hit(self._item, key):
                return None
            stats = await self._strategy.get_window_stats(self._item, key)
            return max(1, int(stats.reset_time - time.time()))
        except Exception as error:  # noqa: BLE001 — see the docstring
            logger.warning("rate limit storage failed (%r) — allowing the turn", error)
            return None
