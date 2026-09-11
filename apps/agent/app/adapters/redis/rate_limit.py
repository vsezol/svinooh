"""Rate-limit counters in Redis — one adapter behind ports.RateLimiter.

The counting is not ours. The `limits` library — the engine inside
flask-limiter and slowapi — provides the moving-window strategy and the
storage. Production rate limiting is a solved problem with sharp edges (window
arithmetic, races), so we buy the arithmetic and keep what is genuinely ours:
the KEY, a caller named by our auth gate rather than an IP.

Why Redis at all: in-process counting is not a smaller rate limit, it is the
limit multiplied by however many replicas are running, which is the cost lock
not holding.

Two details worth stating, because both look like details and are not:

- `implementation="redispy"` rather than the library's default coredis, so the
  service carries one Redis client library instead of two.
- `connection_pool=` is what keeps the pool count at one. The library builds
  its own client, but its redis-py bridge reuses a pool when it is handed one,
  so this is the difference between sharing our pool and quietly opening a
  second one to the same instance.
"""

from limits.aio.storage import RedisStorage
from redis.asyncio import ConnectionPool

#: Keeps the counters out of the way of everything else on the instance. See
#: adapters/redis/conversations.py on sharing.
KEY_PREFIX = "agent:rl"


def storage(url: str, pool: ConnectionPool) -> RedisStorage:
    # The library picks its client from the scheme, and its async Redis storage
    # speaks `async+redis://`.
    uri = url if url.startswith("async+") else f"async+{url}"
    return RedisStorage(
        uri,
        implementation="redispy",
        key_prefix=KEY_PREFIX,
        # Forwarded to the client untouched; the stub types **options narrower
        # than what the library actually passes through.
        connection_pool=pool,  # type: ignore[arg-type]
    )
