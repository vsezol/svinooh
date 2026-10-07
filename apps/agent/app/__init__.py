from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import errors
from .api.routes import router
from .container import Container, build
from .domain.identity import ANON_HEADER
from .observability.logs import configure as configure_logging
from .observability.middleware import Observed
from .observability.tracing import configure as configure_tracing
from .settings import Settings


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    container: Container = app.state.container
    await container.start()
    try:
        yield
    finally:
        await container.stop()


def create_app(container: Container | None = None) -> FastAPI:
    configure_logging()
    configure_tracing()
    wired = container if container is not None else build(Settings())
    app = FastAPI(title="svinooh-ai", lifespan=_lifespan)
    app.state.container = wired
    app.add_middleware(Observed)
    origins = wired.settings.cors_origins
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(origins),
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["authorization", "content-type", ANON_HEADER.lower()],
            max_age=3600,
        )
    errors.install(app)
    app.include_router(router)
    return app
