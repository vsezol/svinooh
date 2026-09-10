"""The one connection pool, and the only place redis-py is configured.

Two things live on this instance — conversations and the rate limiter's
counters — and the composition root (app/container.py) hands both the same
pool, so the service opens one rather than one per feature. The `limits`
library builds its own client but reuses a pool it is given; see rate_limit.py.
"""

from redis.asyncio import ConnectionPool


def pool(url: str) -> ConnectionPool:
    """A pool for this URL. Opens nothing until the first command.

    decode_responses, so what comes back is str: every value we put here is
    JSON this service wrote. redis-py resolves with AF_UNSPEC, so Railway's
    IPv6-only private network needs nothing extra.
    """
    return ConnectionPool.from_url(url, decode_responses=True)
