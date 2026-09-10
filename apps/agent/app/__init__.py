"""svinooh-ai, the AI agent microservice.

POST /chat takes a message, runs it through the graph with the conversation's
history, and answers in blocks. The layers: app/domain is what a conversation
is, app/services what is done with one, app/adapters where it is kept and
where the portfolio comes from, app/agent the graph and the model, app/api
the wire — and app/container.py the one place they are introduced.
"""

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .container import Container, build
from .domain.identity import ANON_HEADER
from .settings import Settings


class _Below(logging.Filter):
    """Records under a level — the half that belongs on stdout."""

    def __init__(self, level: int) -> None:
        super().__init__()
        self.level = level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno < self.level


def _configure_logging() -> None:
    """Make this service's own log lines reach the platform, and say which are bad.

    Two problems, and the second one hid behind the first.

    Nothing configures logging under uvicorn except uvicorn's own loggers, so
    a message from `svinooh-ai` fell through to logging's last-resort handler
    — which prints WARNING and above and drops everything below. That is why
    the routing decisions, the tool calls and the created portfolios were
    invisible while their failures were not.

    Then every line that did arrive was marked an error, because Python logs
    to stderr and the platform reads a stream as a severity. A routing decision
    and a refused endpoint looked identical, so "show me the errors" showed
    everything, which is the same as showing nothing. Ordinary lines go to
    stdout now and warnings and above to stderr, which is the convention the
    platform is actually reading.
    """
    ordinary = logging.StreamHandler(sys.stdout)
    ordinary.addFilter(_Below(logging.WARNING))
    # The two halves have to be exclusive at both ends. A handler with no level
    # takes everything, so without this the ordinary lines would go out on both
    # streams — and one event logged twice is two events to whoever counts them.
    bad = logging.StreamHandler(sys.stderr)
    bad.setLevel(logging.WARNING)
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s %(message)s",
        handlers=[ordinary, bad],
        force=True,
    )
    # Uvicorn keeps its own handlers, which are all on stderr; letting the root
    # handlers have the records too is what puts its access lines on the right
    # stream, and turning propagation off would be the reverse of the fix.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers.clear()
    logging.getLogger("httpx").setLevel(logging.WARNING)


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
    _configure_logging()
    wired = container if container is not None else build(Settings())
    app = FastAPI(title="svinooh-ai", lifespan=_lifespan)
    app.state.container = wired
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
    app.include_router(router)
    return app
