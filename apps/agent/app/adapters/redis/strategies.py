from redis.asyncio import ConnectionPool, Redis

_LPDOWN = "agent:lpdown:"


class RedisStrategies:
    def __init__(self, pool: ConnectionPool) -> None:
        self._redis = Redis(connection_pool=pool)

    async def running(self, portfolio: str) -> bool:
        return bool(await self._redis.exists(f"{_LPDOWN}{portfolio}"))

    async def run(self, portfolio: str, on: bool) -> None:
        if on:
            await self._redis.set(f"{_LPDOWN}{portfolio}", "1")
        else:
            await self._redis.delete(f"{_LPDOWN}{portfolio}")
