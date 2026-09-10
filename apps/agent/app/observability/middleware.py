"""What every request leaves behind: an id on its log lines, and a measurement.

Plain ASGI rather than Starlette's BaseHTTPMiddleware, because one of these
routes is a stream: BaseHTTPMiddleware runs the response through a queue,
which is exactly the buffering /chat/stream exists to avoid.
"""

import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from . import metrics
from .logs import request_id

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict]]
Send = Callable[[dict], Awaitable[None]]


class Observed:
    """Times each request, names it, and tags whatever it logs."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        token = request_id.set(uuid.uuid4().hex[:12])
        started = time.perf_counter()
        status = 500

        async def watched(message: dict) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
            await send(message)

        try:
            await self._app(scope, receive, watched)
        finally:
            # After the last byte, which for a stream is the whole turn — the
            # number worth having, and the one a timer around the handler
            # alone would miss.
            elapsed = time.perf_counter() - started
            labels = {
                "method": str(scope.get("method", "")),
                # The route TEMPLATE, never the path: /chats/{chat_id} is one
                # series and /chats/3kFm9x is one series per conversation.
                "route": getattr(scope.get("route"), "path", "unmatched"),
                "status": str(status),
            }
            metrics.counted(metrics.http_requests, **labels)
            metrics.timed(metrics.http_duration, elapsed, **labels)
            request_id.reset(token)
