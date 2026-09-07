"""How often one caller may ask — the cost lock on an LLM endpoint.

Every chat turn is a paid model call (several, when tools run), so the rate
limit is not etiquette here: it is the cap on what one caller can spend.
Sliding window over timestamps, per caller, in memory — per instance and gone
on restart, which is the right size while the service is one process; the
step up (shared Redis counters) changes this module, not its callers.
"""
import time
from collections import deque


class RateLimiter:
    def __init__(self, max_requests: int, window_s: int):
        self._max = max_requests
        self._window = window_s
        self._hits: dict[str, deque[float]] = {}

    def retry_after(self, key: str) -> int | None:
        """Record an attempt; None means allowed, a number is seconds to wait."""
        now = time.time()
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - self._window:
            hits.popleft()
        if len(hits) >= self._max:
            return max(1, int(hits[0] + self._window - now))
        hits.append(now)
        # Lazy tidy-up of keys nobody used for a full window, same reason the
        # session store evicts on the read path: nothing extra to crash.
        if len(self._hits) > 1000:
            dead = [k for k, d in self._hits.items() if not d or d[-1] <= now - self._window]
            for k in dead:
                del self._hits[k]
        return None
