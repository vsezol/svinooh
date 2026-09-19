from redis.asyncio import ConnectionPool


def pool(url: str) -> ConnectionPool:
    return ConnectionPool.from_url(url, decode_responses=True)
