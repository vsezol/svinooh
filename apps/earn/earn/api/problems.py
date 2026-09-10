"""Failures, in one shape: RFC 9457 `application/problem+json`.

Two audiences. A person reads `title` and `detail`; a program branches on
`type`, which is a stable URI and outlives any wording change. FastAPI's own
`{"detail": "…"}` gives a program nothing but the status code, and "400" does
not say whether to retry without the cursor or to fix the filters.

The translation table below is the only place the application's vocabulary
meets HTTP's. Anything not in it is not our failure and surfaces as the 500 it
is, rather than being flattened into a polite 400.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from earn.api.cursors import MalformedCursor
from earn.application.errors import (
    CatalogNotReady,
    CatalogVersionGone,
    PoolNotFound,
    SelectionMismatch,
)
from earn.domain.errors import EarnError

PROBLEM_BASE = "https://svinooh.com/problems"
MEDIA_TYPE = "application/problem+json"

#: application failure -> (status, type slug, title). One line per thing that
#: can go wrong, which is also the list a client can usefully branch on.
TRANSLATIONS: dict[type[Exception], tuple[int, str, str]] = {
    CatalogNotReady: (503, "not-ready", "Not ready"),
    PoolNotFound: (404, "not-found", "Not found"),
    CatalogVersionGone: (400, "cursor-expired", "Invalid cursor"),
    SelectionMismatch: (400, "cursor-query-mismatch", "Invalid cursor"),
    MalformedCursor: (400, "invalid-cursor", "Invalid cursor"),
}

DETAILS: dict[type[Exception], str] = {
    CatalogNotReady: "the catalog has not been built yet; retry shortly",
    CatalogVersionGone: (
        "the data this cursor points into has been refreshed; start again without it"
    ),
    SelectionMismatch: (
        "this cursor was issued for a different set of filters; start again without it"
    ),
    MalformedCursor: "cursor is not one we issued",
}


def problem(status: int, slug: str, title: str, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        media_type=MEDIA_TYPE,
        content={
            "type": f"{PROBLEM_BASE}/{slug}",
            "title": title,
            "status": status,
            "detail": detail,
        },
    )


def install(app: FastAPI) -> None:
    async def translated(_: Request, error: Exception) -> JSONResponse:
        status, slug, title = TRANSLATIONS[type(error)]
        return problem(status, slug, title, DETAILS.get(type(error)) or str(error))

    for failure in TRANSLATIONS:
        app.add_exception_handler(failure, translated)

    async def unmapped(_: Request, error: Exception) -> JSONResponse:
        # An EarnError with no translation is a gap in the table above, not a
        # generic error — better to answer 500 loudly than to invent a status.
        return problem(500, "internal", "Internal error", str(error))

    app.add_exception_handler(EarnError, unmapped)

    async def invalid_parameter(_: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, RequestValidationError)
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(part) for part in tuple(first.get("loc", ()))[1:]) or "request"
        return problem(
            422,
            "invalid-parameter",
            "Invalid parameter",
            f"{where}: {first.get('msg', 'is not valid')}",
        )

    app.add_exception_handler(RequestValidationError, invalid_parameter)

    async def http_error(_: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, StarletteHTTPException)
        slug = {404: "not-found", 405: "method-not-allowed"}.get(error.status_code, "error")
        return problem(error.status_code, slug, "Error", str(error.detail))

    app.add_exception_handler(StarletteHTTPException, http_error)
