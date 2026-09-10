"""svinooh-ai — the AI agent microservice.

An internal service behind the api gateway (the gateway forwards /ai/* here,
the way /auth/* goes to auth): POST /chat takes a message, runs it through the
model with the session's history, and returns the reply. Portfolio context,
tools and a graph grow behind this surface one layer at a time — the outward
contract does not change with them.

Structured the way a production service is, even while small, so each concern
has a home before it grows: config.py (settings, later fetched remotely),
llm.py (the provider-neutral model seam), sessions.py (conversations, and the
context derived from them) over store.py (where they are kept), owner.py (who
is asking), routes.py (the HTTP surface), schemas.py (the wire types).
"""

import logging
import sys
from collections.abc import Sequence

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import remote_config
from .api.routes import router
from .config import settings
from .domain.identity import ANON_HEADER


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


def create_app(cors_origins: Sequence[str] | None = None) -> FastAPI:
    _configure_logging()
    app = FastAPI(title="svinooh-ai")
    # The browser door: which origins may call this service directly. An
    # explicit allowlist, never "*" — the wildcard forbids credentialed
    # requests anyway, and this API is nothing but credentialed requests.
    origins = settings.cors_origins if cors_origins is None else tuple(cors_origins)
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

    @app.on_event("startup")
    async def _load_settings() -> None:
        # So the first turn already runs on what the panel says rather than on
        # the environment the container booted with.
        await remote_config.prime()

    app.include_router(router)

    return app
