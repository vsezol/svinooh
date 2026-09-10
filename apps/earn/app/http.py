"""One HTTP client for the whole service, and the two rules it follows.

Rule one: every call has a timeout. A refresh that hangs on one slow upstream
call holds the loop and the snapshot ages silently, which is the failure mode
that looks like nothing at all.

Rule two: calls that fan out are bounded (`gather_limited`). A refresh asks
Kamino about 41 markets; doing that all at once is a small stampede against an
API nobody is paying for.
"""
import asyncio
import logging
from typing import Any, Awaitable, Callable, Iterable, TypeVar

import httpx

from .config import settings

log = logging.getLogger("earn.http")

T = TypeVar("T")


class Upstream:
    """A named upstream, so a failure says which one."""

    def __init__(self, base_url: str, client: httpx.AsyncClient) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = client
        self._gate = asyncio.Semaphore(settings.http_concurrency)

    async def get_json(self, path: str, **params: Any) -> Any:
        async with self._gate:
            response = await self._client.get(
                f"{self.base_url}{path}",
                params={k: v for k, v in params.items() if v is not None},
            )
        response.raise_for_status()
        return response.json()


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(settings.http_timeout_s),
        # A default UA gets 403 from some CDNs in front of public APIs. Saying
        # who we are is both politer and more reliable than pretending.
        headers={"user-agent": "svinooh-earn/1.0 (+https://svinooh.com)"},
        follow_redirects=True,
    )


async def gather_limited(
    items: Iterable[T],
    run: Callable[[T], Awaitable[Any]],
    *,
    label: str,
) -> list[Any]:
    """Run `run` over `items`, keeping what succeeded.

    One market being unreachable must not cost us the other forty. The failures
    are logged and counted by the caller — a source that answers with half its
    pools is degraded, and the snapshot records that (see app/catalog.py).
    """
    materialised = list(items)
    results: list[Any] = []
    outcomes = await asyncio.gather(*(run(item) for item in materialised), return_exceptions=True)
    for item, outcome in zip(materialised, outcomes):
        if isinstance(outcome, Exception):
            log.warning("%s: %s could not be read: %s", label, item, outcome)
            continue
        results.append(outcome)
    return results
