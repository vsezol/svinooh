"""The loop that keeps the catalog current.

Requests never wait on an upstream. This rebuilds the whole catalog on an
interval and publishes it; a request reads what is already there. Three
properties follow, and all three are the reason for the arrangement:

- a cursor points into the catalog it was issued from, so paging a list sorted
  by a number that moves all day does not show a pool twice;
- an upstream being down is not this service being down — the last good catalog
  keeps answering and says how old it is;
- the number of calls made to somebody else's free API depends on the clock,
  not on our traffic.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from datetime import timedelta

from earn.application.catalog_store import CatalogStore
from earn.application.ports import Clock, YieldSource
from earn.domain.catalog import Catalog, ListingPolicy
from earn.domain.pool import Pool

log = logging.getLogger(__name__)


class CatalogRefresher:
    def __init__(
        self,
        *,
        sources: Sequence[YieldSource],
        store: CatalogStore,
        policy: ListingPolicy,
        clock: Clock,
        interval: timedelta,
    ) -> None:
        self._sources = sources
        self._store = store
        self._policy = policy
        self._clock = clock
        self._interval = interval
        #: Set once the first pass has been *attempted*, whether it worked or
        #: not. Startup waits on this so a healthy service is ready on the
        #: first healthcheck probe instead of racing it — and, because a failed
        #: attempt sets it too, a dead upstream delays startup by nothing.
        self.first_pass = asyncio.Event()

    async def refresh_once(self) -> Catalog | None:
        """Read every source and publish what came back.

        Returns the catalog now standing, or None when there is none — which
        happens only on a cold start where every source failed. That is the
        state `/health` reports as "starting": having nothing to say is not the
        same as saying there is nothing.
        """
        pools: list[Pool] = []
        failed: list[str] = []

        results = await asyncio.gather(
            *(source.fetch() for source in self._sources), return_exceptions=True
        )
        for source, result in zip(self._sources, results, strict=True):
            if isinstance(result, BaseException):
                failed.append(source.name)
                log.warning("%s could not be read: %s", source.name, result)
                continue
            pools.extend(result)

        # A source that answered with nothing is indistinguishable from a source
        # that is broken, so an empty result never becomes a published catalog:
        # over a good one it would turn a partial outage into a total one, and
        # on a cold start it would dress "we could not read anything" up as
        # "there is nothing to earn on".
        if not pools:
            standing = self._store.current_or_none()
            log.warning(
                "refresh produced no pools; %s",
                f"keeping catalog {standing.version}" if standing else "nothing to serve yet",
            )
            return standing

        catalog = Catalog.build(
            version=self._store.next_version(),
            taken_at=self._clock(),
            pools=pools,
            policy=self._policy,
            failed_sources=tuple(failed),
        )
        self._store.publish(catalog)
        log.info(
            "catalog %d: %d pools, %d listed%s",
            catalog.version,
            len(catalog.by_id),
            len(catalog.listed),
            f", failed: {', '.join(failed)}" if failed else "",
        )
        return catalog

    async def run_forever(self) -> None:
        """Refresh, wait, repeat — and survive anything one refresh can do.

        The failure that matters here is not a refresh that throws; it is the
        loop dying, because then the data ages forever and nothing says so.
        """
        while True:
            try:
                await self.refresh_once()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.warning("refresh failed, keeping the previous catalog: %s", error)
            self.first_pass.set()
            await asyncio.sleep(self._interval.total_seconds())
