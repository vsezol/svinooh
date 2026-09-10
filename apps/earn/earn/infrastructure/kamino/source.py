"""`KaminoSource` — Kamino, satisfying the `YieldSource` port.

Reserve metrics are read even when reserves are not published as pools of their
own: they are the only place a mint's ticker is written down, and a vault knows
its token by mint address alone.
"""
from __future__ import annotations

import logging
from collections.abc import Sequence

from earn.domain.pool import Pool
from earn.infrastructure.kamino.api import KaminoApi
from earn.infrastructure.kamino.mapping import Index, reserve_to_pool, vault_to_pool

log = logging.getLogger(__name__)


class KaminoSource:
    def __init__(self, api: KaminoApi, *, include_reserves: bool = True) -> None:
        self._api = api
        self._include_reserves = include_reserves

    @property
    def name(self) -> str:
        return "kamino"

    async def fetch(self) -> Sequence[Pool]:
        vaults = await self._api.vaults()
        metrics = await self._api.vault_metrics()
        per_market = await self._api.reserves_by_market(await self._api.markets())
        index = Index.build(vaults, per_market)

        pools: list[Pool] = []
        for vault in vaults:
            pool = vault_to_pool(vault, metrics.get(vault.get("address") or "", {}), index)
            if pool is not None:
                pools.append(pool)

        if self._include_reserves:
            for entry in per_market:
                for reserve in entry["reserves"]:
                    pool = reserve_to_pool(reserve, entry["market"], entry["name"], index)
                    if pool is not None:
                        pools.append(pool)

        log.info(
            "kamino: %d vaults, %d markets, %d pools", len(vaults), len(per_market), len(pools)
        )
        return pools
