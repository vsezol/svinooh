"""svinooh-ai — the AI agent microservice.

An internal service behind the api gateway (the gateway forwards /ai/* here,
the way /auth/* goes to auth): POST /chat takes a message, runs it through the
model with the session's history, and returns the reply. Portfolio context,
tools and a graph grow behind this surface one layer at a time — the outward
contract does not change with them.

Structured the way a production service is, even while small, so each concern
has a home before it grows: config.py (settings, later fetched remotely),
llm.py (the provider-neutral model seam), sessions.py (conversation memory),
routes.py (the HTTP surface), schemas.py (the wire types).
"""
from collections.abc import Sequence

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import router


def create_app(cors_origins: Sequence[str] | None = None) -> FastAPI:
    app = FastAPI(title="svinooh-ai")
    # The browser door: which origins may call this service directly. An
    # explicit allowlist, never "*" — the wildcard forbids credentialed
    # requests anyway, and this API is nothing but credentialed requests.
    origins = settings.cors_origins if cors_origins is None else tuple(cors_origins)
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(origins),
            allow_methods=["GET", "POST"],
            allow_headers=["authorization", "content-type"],
            max_age=3600,
        )
    app.include_router(router)

    return app
