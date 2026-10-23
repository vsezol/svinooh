"""Entrypoint, and nothing else: `uvicorn main:app` is the one command the
Dockerfile needs."""

import os

import httpx
from svinooh_portfolio.pools import PoolCatalog
from svinooh_portfolio.source import PortfolioApiSource

from app.server import create_app

http = httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5))

app = create_app(
    PortfolioApiSource(os.environ.get("PORTFOLIO_API_URL", "http://localhost:3000"), http),
    PoolCatalog(os.environ.get("EARN_API_URL", "http://localhost:8080"), http),
)
