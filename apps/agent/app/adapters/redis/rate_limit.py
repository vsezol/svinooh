from limits.aio.storage import RedisStorage
from redis.asyncio import ConnectionPool

KEY_PREFIX = "agent:rl"


def storage(url: str, pool: ConnectionPool) -> RedisStorage:
    uri = url if url.startswith("async+") else f"async+{url}"
    return RedisStorage(
        uri,
        implementation="redispy",
        key_prefix=KEY_PREFIX,
        connection_pool=pool,  # type: ignore[arg-type]
    )
