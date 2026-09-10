"""`/health` — ready once there is something to answer with.

Not "the process started": Railway gates a deployment on this, and a service
that would answer every request with 503 must not be allowed to replace one
that is serving.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from earn.api.deps import get_now, get_settings
from earn.api.schemas import HealthResponse
from earn.infrastructure.settings import Settings

router = APIRouter(tags=["ops"])


@router.get("/health", response_model=HealthResponse, summary="Readiness")
async def health(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_now)],
) -> HealthResponse:
    catalog = request.app.state.store.current_or_none()
    if catalog is None:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(status="starting")
    return HealthResponse(
        status="ok",
        catalog=catalog.version,
        as_of=catalog.taken_at,
        age_s=round(catalog.age(now).total_seconds()),
        stale=catalog.is_stale(now, settings.stale_after),
        pools=len(catalog.listed),
        degraded=list(catalog.failed_sources),
    )
