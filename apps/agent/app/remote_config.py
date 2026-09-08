"""What the admin panel decided, as the agent hears about it.

The agent has no database and no shared libraries — it reads this product the
way any third-party client would (DESIGN.md) — so the knobs an operator turns
reach it the only way anything reaches it: over HTTP, from
`GET /api/agent/config`.

Two properties matter more than freshness. It must never make a chat turn wait
on a settings fetch, so the refresh happens in the background and a turn always
reads whatever is already in hand. And it must never let a settings outage
become a chat outage, so every failure leaves the previous values standing —
or, if none were ever fetched, the environment the service booted with.
"""
import asyncio
import logging
import time
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger("svinooh-ai")

#: How stale a value may be before the next turn triggers a refresh. Short
#: enough that an experiment in the panel is visible within a coffee sip, long
#: enough that the api sees one small request a minute.
TTL_S = 60

_values: dict[str, Any] = {}
_fetched_at = 0.0
_refreshing = False


def current() -> dict[str, Any]:
    """The knobs as last heard. Empty until the first successful fetch."""
    return _values


def _stale() -> bool:
    return time.time() - _fetched_at > TTL_S


async def _fetch() -> None:
    global _values, _fetched_at, _refreshing
    try:
        async with httpx.AsyncClient(timeout=settings.context_timeout_s) as client:
            response = await client.get(f"{settings.portfolio_api_url.rstrip('/')}/api/agent/config")
            response.raise_for_status()
            incoming = response.json()
        if not isinstance(incoming, dict):
            raise ValueError(f"expected an object, got {type(incoming).__name__}")
        if incoming != _values:
            logger.info("agent config changed: %s", incoming)
        _values = incoming
        _fetched_at = time.time()
    except Exception as error:  # noqa: BLE001 — settings must not break chatting
        # Deliberately keeps the old values and the old timestamp: the next
        # turn tries again, and in the meantime the agent runs on what it had.
        logger.warning("agent config not fetched (%r) — keeping the current values", error)
    finally:
        _refreshing = False


def refresh_soon() -> None:
    """Start a refresh if the values are stale and none is already running.

    Called from the request path but never awaited there: a person waiting for
    an answer must not also wait for a settings poll.
    """
    global _refreshing
    if _refreshing or not _stale():
        return
    _refreshing = True
    try:
        task = asyncio.create_task(_fetch())
    except RuntimeError:
        # No loop running — a script or a test. Nothing to refresh into.
        _refreshing = False
        return
    _background.add(task)
    task.add_done_callback(_background.discard)


# asyncio holds tasks weakly; an unreferenced one can be collected mid-flight.
_background: set[asyncio.Task] = set()


async def prime() -> None:
    """Fetch once at startup, so the first turn already runs on the real values."""
    await _fetch()
