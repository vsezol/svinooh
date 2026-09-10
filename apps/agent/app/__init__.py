"""svinooh-ai, the AI agent microservice.

POST /chat takes a message, runs it through the graph with the conversation's
history, and answers in blocks. The layers: app/domain is what a conversation
is, app/application what is done with one, app/adapters where it is kept and
where the portfolio comes from, app/agent the graph and the model, app/api
the wire — and app/container.py the one place they are introduced.
"""

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
from .settings import Settings


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup before the yield, shutdown after it — both the container's."""
    container: Container = app.state.container
    await container.start()
    try:
        yield
    finally:
        await container.stop()


def create_app(container: Container | None = None) -> FastAPI:
    """The service, wired from the environment unless handed a container."""
    configure_logging()
    wired = container if container is not None else build(Settings())
    app = FastAPI(title="svinooh-ai", lifespan=_lifespan)
    app.state.container = wired
    # Outermost, so a request is timed whatever answers it — a refusal from
    # the CORS layer included.
    app.add_middleware(Observed)
    # The browser door: which origins may call this service directly. An
    # explicit allowlist, never "*" — the wildcard forbids credentialed
    # requests anyway, and this API is nothing but credentialed requests.
    origins = wired.settings.cors_origins
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(origins),
            # DELETE is here for /chats/{id}: a conversation is a server object
            # now, so removing one is a request rather than a line dropped from
            # a browser's own list.
            allow_methods=["GET", "POST", "DELETE"],
            # The anonymous id rides on a header of ours, and a custom request
            # header a browser sends is a header CORS has to be told about —
            # otherwise the preflight refuses it and every call from the widget
            # arrives with no identity at all.
            allow_headers=["authorization", "content-type", ANON_HEADER.lower()],
            max_age=3600,
        )
    # What each domain refusal means on the wire, in one place.
    errors.install(app)
    app.include_router(router)
    return app
