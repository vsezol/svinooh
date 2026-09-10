"""The catalog: one immutable snapshot of every pool, rebuilt in the background.

Requests never wait on Kamino. A task rebuilds the whole catalog every few
minutes — three calls plus one per market, a couple of seconds — and swaps the
result in. Everything a request does is read a list that is already in memory.

Three properties fall out of that, and all three are the reason for it:

- **A page is a page.** Cursor pagination points into the snapshot it was
  issued from (app/query.py), so a client that starts reading a list sorted by
  APY finishes reading *that* list, instead of seeing pools twice because the
  rates moved between page one and page two.
- **Kamino being down is not us being down.** A failed refresh keeps the last
  good snapshot and says so — `meta.stale`. A rate from twenty minutes ago is
  a useful answer; a 502 is not.
- **One upstream request serves everybody.** The number of calls we make to
  somebody else's free API depends on the clock, not on our traffic.

The cost is memory: a few hundred pools times the snapshots we keep, which is
nothing, and staleness bounded by the refresh interval, which is the point.
"""
import asyncio
import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import settings
from .domain import Pool
from .http import Upstream, make_client
from .sources import kamino

log = logging.getLogger("earn.catalog")


@dataclass(frozen=True)
class Snapshot:
    """Every pool as of one moment. Never mutated once published."""

    id: int
    at: datetime
    #: The pools worth listing, in no particular order — sorting is per request.
    listed: tuple[Pool, ...]
    #: Every pool, listed or not, by id. A pool below the listing floor is still
    #: a real pool somebody may hold shares in, and asking for it by id must
    #: answer rather than 404.
    by_id: dict[str, Pool] = field(default_factory=dict)
    #: Sources that could not be read for this snapshot. Empty is the good case.
    failed: tuple[str, ...] = ()

    def age_s(self, now: datetime | None = None) -> float:
        return ((now or datetime.now(timezone.utc)) - self.at).total_seconds()

    def is_stale(self, now: datetime | None = None) -> bool:
        return self.age_s(now) > settings.stale_after_s


def _worth_listing(pool: Pool) -> bool:
    """Whether a pool belongs in a list somebody browses.

    Kamino's API returns every vault ever created — 178 of them against the ~30
    its own UI shows — because test and staging vaults and ones nobody funded
    are still vaults. Kamino's frontend hides them behind a minimum-shares
    check, which is not exposed anywhere in the API, so the floor here is ours
    and is a judgement call, not a fact: EARN_MIN_TVL_USD, plus a name filter
    for the ones that announce themselves.
    """
    if pool.tvl_usd < settings.min_tvl_usd:
        return False
    # Reserves that pay nothing are real accounts you can really deposit into —
    # collateral-only reserves with borrowing switched off — and they are not
    # an answer to "where can I earn". They stay addressable by id.
    if pool.apy.net <= 0:
        return False
    name = pool.name.lower()
    return not any(mark in name for mark in settings.excluded_name_marks)


class Catalog:
    """Holds the snapshots and the task that makes them."""

    def __init__(self) -> None:
        self._snapshots: deque[Snapshot] = deque(maxlen=max(1, settings.snapshot_history))
        self._next_id = 1
        self._task: asyncio.Task | None = None
        self._client = None
        #: Set once a first snapshot exists. `/health` waits on this rather than
        #: reporting a service that cannot answer anything as ready.
        self.ready = asyncio.Event()

    # ── reading ─────────────────────────────────────────────────────────────

    def current(self) -> Snapshot | None:
        return self._snapshots[-1] if self._snapshots else None

    def find(self, snapshot_id: int) -> Snapshot | None:
        """A snapshot a cursor was issued from, while it is still remembered."""
        for snapshot in self._snapshots:
            if snapshot.id == snapshot_id:
                return snapshot
        return None

    # ── the loop ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._client = make_client()
        self._task = asyncio.create_task(self._loop(), name="earn-refresh")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._client:
            await self._client.aclose()

    async def _loop(self) -> None:
        while True:
            try:
                await self.refresh()
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 — the loop must outlive any one failure
                # Deliberately swallowed: a refresh that throws leaves the last
                # good snapshot in place, and the next tick tries again. The
                # only thing that must not happen is the loop dying, because
                # then the data ages forever and nothing says so.
                log.warning("refresh failed, keeping the previous snapshot: %s", error)
            await asyncio.sleep(settings.refresh_interval_s)

    async def refresh(self) -> Snapshot:
        assert self._client is not None, "start() first"
        upstream = Upstream(settings.kamino_api, self._client)

        pools: list[Pool] = []
        failed: list[str] = []
        try:
            pools.extend(await kamino.fetch_pools(upstream))
        except Exception as error:  # noqa: BLE001
            failed.append("kamino")
            log.warning("kamino could not be read: %s", error)

        # A source that answered with nothing is indistinguishable from a source
        # that is broken, and publishing an empty catalog over a good one turns
        # a partial outage into a total one.
        if not pools:
            previous = self.current()
            if previous is not None:
                log.warning("refresh produced no pools; keeping snapshot %d", previous.id)
                return previous

        snapshot = Snapshot(
            id=self._next_id,
            at=datetime.now(timezone.utc),
            listed=tuple(pool for pool in pools if _worth_listing(pool)),
            by_id={pool.id: pool for pool in pools},
            failed=tuple(failed),
        )
        self._next_id += 1
        self._snapshots.append(snapshot)
        self.ready.set()
        log.info(
            "snapshot %d: %d pools, %d listed%s",
            snapshot.id,
            len(pools),
            len(snapshot.listed),
            f", failed: {', '.join(failed)}" if failed else "",
        )
        return snapshot


catalog = Catalog()
