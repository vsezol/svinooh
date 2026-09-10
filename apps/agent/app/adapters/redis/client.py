"""The connection, and the only import of redis-py in the service.

**One pool.** Two things live on this instance — conversations and the rate
limiter's counters — and before this module they each built their own client
from the same URL, so the service held two connection pools to one Redis for
no reason anybody had decided on. Both now take the pool from here.

The `limits` library builds its own client, which is why sharing needs saying
out loud: its redis-py bridge accepts a `connection_pool` and reuses it when
given one, so passing this pool is what keeps the count at one rather than
two. See adapters/redis/rate_limit.py.

Nothing above app/adapters imports this. The layers above name the ports in
app/ports.py, and app/composition.py is the only place that knows a vendor was
chosen at all.
"""

import logging

from redis.asyncio import ConnectionPool, Redis

logger = logging.getLogger("svinooh-ai")

_pool: ConnectionPool | None = None


def pool(url: str) -> ConnectionPool:
    """The service's one pool, built on first use.

    Lazy rather than built at import: a module that opens sockets when it is
    imported cannot be imported by a test, and the composition root is what
    decides whether Redis is used at all.

    redis-py resolves with AF_UNSPEC, so Railway's IPv6-only private network
    needs no equivalent of the `family: 0` the api's ioredis client sets.
    """
    global _pool
    if _pool is None:
        # decode_responses so what comes back is str — every value we put here
        # is JSON this service wrote.
        _pool = ConnectionPool.from_url(url, decode_responses=True)
        logger.info("redis pool opened")
    return _pool


def client(url: str) -> Redis:
    """A client on the shared pool. Cheap — the pool is the expensive part."""
    return Redis(connection_pool=pool(url))


async def close() -> None:
    """Let go of the pool. For tests and for a clean shutdown."""
    global _pool
    if _pool is not None:
        await _pool.disconnect()
        _pool = None
