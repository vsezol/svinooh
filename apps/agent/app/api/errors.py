from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ..domain.errors import (
    EmptyMessageError,
    MessageTooLongError,
    NoSuchConversationError,
    RateLimitedError,
    TurnTimedOutError,
    UnknownTokenError,
)

Handler = Callable[[Request, Exception], Response | Awaitable[Response]]


def _refusal(status: int, detail: str) -> Handler:
    def handle(_request: Request, _error: Exception) -> Response:
        return JSONResponse(status_code=status, content={"detail": detail})

    return handle


def _rate_limited(_request: Request, error: Exception) -> Response:
    retry_after = error.retry_after if isinstance(error, RateLimitedError) else 1
    return JSONResponse(
        status_code=429,
        content={"detail": "rate limited — try again shortly"},
        headers={"Retry-After": str(retry_after)},
    )


def _too_long(_request: Request, error: Exception) -> Response:
    limit = error.limit if isinstance(error, MessageTooLongError) else 0
    return JSONResponse(
        status_code=413, content={"detail": f"message too long — at most {limit} characters"}
    )


def install(app: FastAPI) -> None:
    app.add_exception_handler(EmptyMessageError, _refusal(400, "empty message"))
    app.add_exception_handler(UnknownTokenError, _refusal(401, "unknown token"))
    app.add_exception_handler(RateLimitedError, _rate_limited)
    app.add_exception_handler(NoSuchConversationError, _refusal(404, "no such conversation"))
    app.add_exception_handler(MessageTooLongError, _too_long)
    app.add_exception_handler(TurnTimedOutError, _refusal(504, "the answer took too long"))
