"""One HTTP client, and the two rules every call through it follows.

**Every call has a timeout.** A refresh that hangs on one slow response holds
the loop and the catalog ages silently, which is the failure mode that looks
like nothing at all.

**Fan-out is bounded.** A refresh asks Kamino about 41 markets; doing that at
once is a small stampede against an API nobody is paying for.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable
from types import TracebackType
from typing import Any, Protocol, Self

import httpx

log = logging.getLogger(__name__)

USER_AGENT = "svinooh-earn/1.0 (+https://svinooh.com)"


class JsonTransport(Protocol):
    """Somewhere JSON comes from.

    Narrow on purpose: it is the entire surface an API client needs, which is
    what lets a test drive the real `KaminoApi` — its pagination, its joins,
    its tolerance — against recorded payloads and no socket.
    """

    async def get(self, path: str, **params: Any) -> Any: ...


class JsonApi:
    """A base URL with a client and a concurrency gate in front of it."""

    def __init__(self, base_url: str, *, timeout_s: float, concurrency: int) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_s),
            # A default user agent gets 403 from some CDNs in front of public
            # APIs. Saying who we are is both politer and more reliable than
            # pretending to be a browser.
            headers={"user-agent": USER_AGENT},
            follow_redirects=True,
        )
        self._gate = asyncio.Semaphore(concurrency)

    async def get(self, path: str, **params: Any) -> Any:
        async with self._gate:
            response = await self._client.get(
                f"{self._base_url}{path}",
                params={key: value for key, value in params.items() if value is not None},
            )
        response.raise_for_status()
        return response.json()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()


async def gather_successful[T, R](
    items: Iterable[T], run: Callable[[T], Awaitable[R]], *, label: str
) -> list[R]:
    """Run `run` over `items`, keeping what succeeded.

    One market being unreachable must not cost us the other forty. What is lost
    is logged; whether a partly-read source counts as degraded is the caller's
    call, not this helper's.
    """
    materialised = list(items)
    outcomes = await asyncio.gather(*(run(item) for item in materialised), return_exceptions=True)
    kept: list[R] = []
    for item, outcome in zip(materialised, outcomes, strict=True):
        if isinstance(outcome, BaseException):
            log.warning("%s: %s could not be read: %s", label, item, outcome)
            continue
        kept.append(outcome)
    return kept
