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
            elapsed = time.perf_counter() - started
            labels = {
                "method": str(scope.get("method", "")),
                "route": getattr(scope.get("route"), "path", "unmatched"),
                "status": str(status),
            }
            metrics.counted(metrics.http_requests, **labels)
            metrics.timed(metrics.http_duration, elapsed, **labels)
            request_id.reset(token)
