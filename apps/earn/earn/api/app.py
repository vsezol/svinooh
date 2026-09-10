"""The composition root: the one place that knows how the parts fit together.

Every dependency is built here and injected. That is what makes the seams real
rather than decorative — a test builds the same application around a fake
`YieldSource` and a frozen clock, with nothing patched and nothing global.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from earn.api import problems
from earn.api.routes import health, lend
from earn.application.catalog_store import CatalogStore
from earn.application.ports import Clock, YieldSource
from earn.application.queries import LendQueries
from earn.application.refresher import CatalogRefresher
from earn.domain.catalog import ListingPolicy
from earn.domain.values import Usd
from earn.infrastructure import logging as log_setup
from earn.infrastructure.http import JsonApi
from earn.infrastructure.kamino.api import KaminoApi
from earn.infrastructure.kamino.source import KaminoSource
from earn.infrastructure.settings import Settings


def utc_now() -> datetime:
    return datetime.now(UTC)


def create_app(
    settings: Settings | None = None,
    *,
    sources: Sequence[YieldSource] | None = None,
    clock: Clock | None = None,
) -> FastAPI:
    """Build the application.

    `sources` and `clock` are parameters and not imports so that the thing
    under test is the real application. Left out, the real Kamino adapter and
    the real clock are used, which is what production gets.
    """
    log_setup.configure()
    settings = settings or Settings()
    tick: Clock = clock or utc_now

    store = CatalogStore(history=settings.catalog_history)
    policy = ListingPolicy(
        min_tvl=Usd(settings.min_tvl_usd),
        excluded_name_marks=settings.excluded_name_marks,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # The refresh loop is tied to the lifespan rather than started on first
        # use, so the service is warming up from the moment it boots and
        # /health can tell "starting" from "broken".
        upstream: JsonApi | None = None
        if sources is None:
            upstream = JsonApi(
                settings.kamino_api,
                timeout_s=settings.http_timeout_s,
                concurrency=settings.http_concurrency,
            )
            active: Sequence[YieldSource] = [
                KaminoSource(KaminoApi(upstream), include_reserves=settings.include_reserves)
            ]
        else:
            active = sources

        refresher = CatalogRefresher(
            sources=active,
            store=store,
            policy=policy,
            clock=tick,
            interval=settings.refresh_interval,
        )
        task = asyncio.create_task(refresher.run_forever(), name="earn-refresh")
        # Wait for the first pass, but not forever: ready on the first probe
        # when upstream is healthy, and still starting when it is not.
        with suppress(TimeoutError):
            await asyncio.wait_for(refresher.first_pass.wait(), settings.startup_grace_s)
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            if upstream is not None:
                await upstream.aclose()

    app = FastAPI(
        title="svinooh earn",
        summary=(
            "Where a single token can be deposited to earn a rate, "
            "across chains and protocols."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.store = store
    app.state.queries = LendQueries(store)
    app.state.clock = tick

    problems.install(app)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET"],
            allow_headers=["*"],
        )

    app.include_router(health.router)
    app.include_router(lend.router)
    return app
