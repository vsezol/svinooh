"""Errors, in one shape: RFC 9457 `application/problem+json`.

Two audiences. A person reads `title` and `detail`; a program branches on
`type`, which is a stable URI and outlives any wording change. FastAPI's own
`{"detail": "..."}` gives the program nothing to branch on but the status code,
and "400" does not tell a client whether to retry without its cursor or to fix
its filters.
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .query import QueryError

PROBLEM_BASE = "https://svinooh.com/problems"
MEDIA_TYPE = "application/problem+json"


def problem(status: int, kind: str, title: str, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        media_type=MEDIA_TYPE,
        content={
            "type": f"{PROBLEM_BASE}/{kind}",
            "title": title,
            "status": status,
            "detail": detail,
        },
    )


def install(app: FastAPI) -> None:
    @app.exception_handler(QueryError)
    async def _query_error(_: Request, error: QueryError) -> JSONResponse:
        return problem(400, error.kind, "Invalid query", error.detail)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ())[1:]) or "request"
        return problem(
            422,
            "invalid-parameter",
            "Invalid parameter",
            f"{where}: {first.get('msg', 'is not valid')}",
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return problem(
            error.status_code,
            {404: "not-found", 503: "not-ready"}.get(error.status_code, "error"),
            str(error.detail) if error.status_code != 404 else "Not found",
            str(error.detail),
        )
