"""Domain refusals, as HTTP answers.

The one place a rule becomes a status code. Everything below this layer
raises what it means (app/domain/errors.py); this decides that an unknown
token is a 401 and a conversation that is not yours is a 404, and keeps the
body shape FastAPI's own HTTPException produces so no client sees a change.
"""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ..domain.errors import (
    EmptyMessageError,
    NoSuchConversationError,
    RateLimitedError,
    UnknownTokenError,
)

Handler = Callable[[Request, Exception], Response | Awaitable[Response]]


def _refusal(status: int, detail: str) -> Handler:
    def handle(_request: Request, _error: Exception) -> Response:
        return JSONResponse(status_code=status, content={"detail": detail})

    return handle


def _rate_limited(_request: Request, error: Exception) -> Response:
    # The wait is the useful half of this answer: a client that is told to
    # come back in 42 seconds does, and one that is only refused retries now.
    retry_after = error.retry_after if isinstance(error, RateLimitedError) else 1
    return JSONResponse(
        status_code=429,
        content={"detail": "rate limited — try again shortly"},
        headers={"Retry-After": str(retry_after)},
    )


def install(app: FastAPI) -> None:
    """Teach the app what each refusal means on the wire."""
    app.add_exception_handler(EmptyMessageError, _refusal(400, "empty message"))
    app.add_exception_handler(UnknownTokenError, _refusal(401, "unknown token"))
    app.add_exception_handler(RateLimitedError, _rate_limited)
    app.add_exception_handler(NoSuchConversationError, _refusal(404, "no such conversation"))
