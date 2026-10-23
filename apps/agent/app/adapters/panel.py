import asyncio
import logging
from contextlib import suppress
from typing import Any

import httpx

from ..panel import NOTHING_DECIDED, PanelValues, ProductFact

logger = logging.getLogger("svinooh-ai")

REFRESH_EVERY_S = 60.0


def _word(raw: dict[str, Any], key: str) -> str | None:
    value = raw.get(key)
    return value if isinstance(value, str) and value else None


def _thinking(raw: dict[str, Any], key: str) -> str | None:
    value = _word(raw, key)
    return "" if value == "default" else value


def _count(raw: dict[str, Any], key: str, *, at_least: int) -> int | None:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < at_least:
        return None
    return value


def _switch(raw: dict[str, Any], key: str) -> bool | None:
    value = raw.get(key)
    return {"on": True, "off": False}.get(value) if isinstance(value, str) else None


def _facts(raw: dict[str, Any]) -> tuple[ProductFact, ...]:
    entries = raw.get("product")
    if not isinstance(entries, list):
        return ()
    return tuple(
        ProductFact(q=str(entry.get("q") or ""), a=str(entry["a"]))
        for entry in entries
        if isinstance(entry, dict) and entry.get("a")
    )


def parse(raw: object) -> PanelValues:
    if not isinstance(raw, dict):
        return NOTHING_DECIDED
    return PanelValues(
        model=_word(raw, "model"),
        reasoning_effort=_thinking(raw, "reasoningEffort"),
        max_tokens=_count(raw, "maxTokens", at_least=1),
        provider_sort=_word(raw, "providerSort"),
        router_model=_word(raw, "routerModel"),
        router_reasoning_effort=_thinking(raw, "routerReasoningEffort"),
        router_max_tokens=_count(raw, "routerMaxTokens", at_least=1),
        router_provider_sort=_word(raw, "routerProviderSort"),
        tool_hops=_count(raw, "toolHops", at_least=0),
        context_max_positions=_count(raw, "contextMaxPositions", at_least=1),
        tracing=_switch(raw, "tracing"),
        product=_facts(raw),
    )


def _knobs(values: PanelValues) -> dict[str, object]:
    return {k: v for k, v in vars(values).items() if k != "product" and v is not None}


class RemotePanel:
    def __init__(
        self,
        base_url: str,
        client: httpx.AsyncClient,
        every_s: float = REFRESH_EVERY_S,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/api/agent/config"
        self._client = client
        self._every_s = every_s
        self._values = NOTHING_DECIDED
        self._refreshing: asyncio.Task[None] | None = None

    def current(self) -> PanelValues:
        return self._values

    async def fetch(self) -> None:
        try:
            response = await self._client.get(self._url)
            response.raise_for_status()
            incoming = parse(response.json())
        except Exception as error:  # noqa: BLE001 — settings must not break chatting
            logger.warning("agent config not fetched (%r) — keeping the current values", error)
            return
        if incoming != self._values:
            logger.info("agent config changed: %s", _knobs(incoming))
        self._values = incoming

    async def keep_fresh(self) -> None:
        while True:
            await asyncio.sleep(self._every_s)
            await self.fetch()

    async def start(self) -> None:
        await self.fetch()
        self._refreshing = asyncio.create_task(self.keep_fresh())

    async def stop(self) -> None:
        if self._refreshing is None:
            return
        self._refreshing.cancel()
        with suppress(asyncio.CancelledError):
            await self._refreshing
        self._refreshing = None
