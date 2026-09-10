"""The admin panel, fetched from the host: one adapter behind ports.Panel.

GET /api/agent/config, unauthenticated by design (nothing in it is a secret),
polled in the background so a turn never waits on it, and kept on failure so
a settings outage never becomes a chat outage. Parsing is lenient one field
at a time: a bad value costs that value, never the conversation.
"""

import asyncio
import logging
from typing import Any

import httpx

from ..panel import NOTHING_DECIDED, PanelValues, ProductFact

logger = logging.getLogger("svinooh-ai")

#: How often the host is asked again. Short enough that an experiment in the
#: panel lands within a coffee sip, long enough to be one small request a
#: minute.
REFRESH_EVERY_S = 60.0


def _word(raw: dict[str, Any], key: str) -> str | None:
    """A non-empty string, or None: a field left empty is no opinion."""
    value = raw.get(key)
    return value if isinstance(value, str) and value else None


def _thinking(raw: dict[str, Any], key: str) -> str | None:
    # A select cannot offer "nothing", so the panel writes "default" for it,
    # and that IS a decision: send no thinking instruction.
    value = _word(raw, key)
    return "" if value == "default" else value


def _count(raw: dict[str, Any], key: str, *, at_least: int) -> int | None:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < at_least:
        return None
    return value


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
    """The wire's object as typed values; anything unusable reads as no opinion."""
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
        product=_facts(raw),
    )


def _knobs(values: PanelValues) -> dict[str, object]:
    """The dials, without the page of facts: what somebody turned."""
    return {k: v for k, v in vars(values).items() if k != "product" and v is not None}


class RemotePanel:
    """ports.Panel over the host's config endpoint."""

    def __init__(
        self,
        base_url: str,
        timeout_s: float,
        every_s: float = REFRESH_EVERY_S,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/api/agent/config"
        self._timeout_s = timeout_s
        self._every_s = every_s
        self._transport = transport
        self._values = NOTHING_DECIDED

    def current(self) -> PanelValues:
        return self._values

    async def fetch(self) -> None:
        """Ask once. A failure keeps what was in hand, and says so."""
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout_s, transport=self._transport
            ) as client:
                response = await client.get(self._url)
                response.raise_for_status()
                incoming = parse(response.json())
        except Exception as error:  # noqa: BLE001 — settings must not break chatting
            logger.warning("agent config not fetched (%r) — keeping the current values", error)
            return
        if incoming != self._values:
            # The facts are a page of prose and never a surprise; the knobs are
            # what somebody just turned and wants to see land.
            logger.info("agent config changed: %s", _knobs(incoming))
        self._values = incoming

    async def keep_fresh(self) -> None:
        """Ask again every interval, until cancelled. Started by the lifespan."""
        while True:
            await asyncio.sleep(self._every_s)
            await self.fetch()
