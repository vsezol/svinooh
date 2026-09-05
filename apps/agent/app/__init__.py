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
from fastapi import FastAPI

from .routes import router


def create_app() -> FastAPI:
    app = FastAPI(title="svinooh-ai")
    app.include_router(router)
    return app
