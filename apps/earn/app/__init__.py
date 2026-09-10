"""Assembly: the app, its lifespan, and the one route that is not in /v1.

The catalog's refresh loop is tied to the application lifespan rather than
started on first use, so the service is warming up from the moment it boots and
`/health` can tell the difference between "starting" and "broken".
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import errors
from .catalog import catalog
from .config import settings
from .routes import router

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await catalog.start()
    try:
        yield
    finally:
        await catalog.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="svinooh earn",
        summary="Where a single token can be deposited to earn a rate, across chains and protocols.",
        version="1.0.0",
        lifespan=lifespan,
    )
    errors.install(app)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET"],
            allow_headers=["*"],
        )

    @app.get("/health", tags=["ops"])
    async def health() -> JSONResponse:
        """Ready once a snapshot exists — not merely once the process is up.

        Railway's healthcheck gates a deployment on this, and a service that
        would answer every request with 503 must not be allowed to replace one
        that is serving.
        """
        snapshot = catalog.current()
        if snapshot is None:
            return JSONResponse(status_code=503, content={"status": "starting"})
        return JSONResponse(
            {
                "status": "ok",
                "snapshot": snapshot.id,
                "as_of": snapshot.at.isoformat(),
                "age_s": round(snapshot.age_s()),
                "stale": snapshot.is_stale(),
                "pools": len(snapshot.listed),
                "degraded": list(snapshot.failed),
            }
        )

    app.include_router(router)
    return app
