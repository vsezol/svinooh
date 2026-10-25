"""Entrypoint: the service on two ports, `python main.py` in the Dockerfile.

PORT is the one the public domain routes to, where every request needs a
sign-in. MCP_ANONYMOUS_PORT is reached only over the private network, by the
agent reading for visitors who are not signed in.
"""

import asyncio
import logging
import os
import sys

import httpx
import uvicorn
from starlette.applications import Starlette
from svinooh_portfolio.pools import PoolCatalog
from svinooh_portfolio.source import PortfolioApiSource

from app.server import create_anonymous_app, create_app
from app.store import MemoryStore, RedisStore

http = httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5))
source = PortfolioApiSource(os.environ.get("PORTFOLIO_API_URL", "http://localhost:3000"), http)
catalog = PoolCatalog(os.environ.get("EARN_API_URL", "http://localhost:3000/api"), http)

app = create_app(
    source,
    catalog,
    RedisStore(os.environ["REDIS_URL"]) if os.environ.get("REDIS_URL") else MemoryStore(),
    os.environ.get("MCP_PUBLIC_URL", "http://localhost:3000"),
    os.environ.get("WEB_URL", "https://svinooh.com"),
)

anonymous = create_anonymous_app(source, catalog)


async def serve(served: Starlette, port: int) -> None:
    config = uvicorn.Config(served, host="0.0.0.0", port=port, log_config=None)
    await uvicorn.Server(config).serve()


def split_uvicorn_logs_by_level() -> None:
    formatter = logging.Formatter("%(levelname)s: %(message)s")
    ordinary = logging.StreamHandler(sys.stdout)
    ordinary.addFilter(lambda record: record.levelno < logging.WARNING)
    ordinary.setFormatter(formatter)
    bad = logging.StreamHandler(sys.stderr)
    bad.setLevel(logging.WARNING)
    bad.setFormatter(formatter)
    uvicorn_log = logging.getLogger("uvicorn")
    uvicorn_log.setLevel(logging.INFO)
    uvicorn_log.handlers = [ordinary, bad]
    uvicorn_log.propagate = False


async def main() -> None:
    split_uvicorn_logs_by_level()
    await asyncio.gather(
        serve(app, int(os.environ.get("PORT", "3000"))),
        serve(anonymous, int(os.environ.get("MCP_ANONYMOUS_PORT", "3001"))),
    )


if __name__ == "__main__":
    asyncio.run(main())
