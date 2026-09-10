"""What the admin panel decided, as the service hears it.

The values come over HTTP from another service, so two things are pinned:
that a bad field costs that field and never the conversation, and that a
turn always runs on what is already in hand — the last good answer, or
nothing at all — rather than waiting for the host.
"""

import asyncio
import logging

import httpx
import pytest

from app.adapters.panel import RemotePanel, parse
from app.panel import NOTHING_DECIDED, PanelValues, ProductFact

FULL = {
    "model": "openai:answers",
    "reasoningEffort": "low",
    "maxTokens": 2048,
    "routerModel": "openai:labels",
    "routerReasoningEffort": "default",
    "toolHops": 2,
    "contextMaxPositions": 20,
    "providerSort": "throughput",
    "routerProviderSort": "latency",
    "product": [{"q": "Which chains?", "a": "EVM, Solana, TRON and Bitcoin."}],
}


class TestReadingTheWire:
    def test_a_full_payload_reads_as_typed_values(self):
        values = parse(FULL)
        assert (values.model, values.reasoning_effort, values.max_tokens) == (
            "openai:answers",
            "low",
            2048,
        )
        assert (values.router_model, values.router_provider_sort) == ("openai:labels", "latency")
        assert (values.tool_hops, values.context_max_positions) == (2, 20)
        assert values.product == (
            ProductFact(q="Which chains?", a="EVM, Solana, TRON and Bitcoin."),
        )

    def test_an_empty_field_is_no_opinion(self):
        # Clearing a field in the panel means "no opinion", not "set it to nothing".
        values = parse({"model": "", "routerModel": ""})
        assert values.model is None and values.router_model is None

    def test_default_is_the_panels_word_for_no_thinking_instruction(self):
        # A select cannot offer "nothing", so the panel says "default" — and
        # that is a decision, kept apart from a field nobody touched.
        assert parse({"routerReasoningEffort": "default"}).router_reasoning_effort == ""
        assert parse({}).router_reasoning_effort is None

    def test_a_nonsense_number_is_no_opinion(self):
        values = parse({"toolHops": "three", "maxTokens": 0, "contextMaxPositions": True})
        assert (values.tool_hops, values.max_tokens, values.context_max_positions) == (
            None,
            None,
            None,
        )

    def test_zero_tool_hops_is_a_decision(self):
        assert parse({"toolHops": 0}).tool_hops == 0

    def test_facts_keep_their_question_and_drop_what_has_no_answer(self):
        values = parse({"product": [{"q": "?"}, {"a": "Bitcoin balances."}, "junk"]})
        assert values.product == (ProductFact(q="", a="Bitcoin balances."),)

    @pytest.mark.parametrize("raw", [None, "a string", [], 42], ids=str)
    def test_a_payload_that_is_not_an_object_reads_as_nothing(self, raw):
        assert parse(raw) == NOTHING_DECIDED

    @pytest.mark.parametrize("product", [None, "", "a string", {"not": "a list"}, 42], ids=str)
    def test_facts_in_a_shape_we_did_not_expect_are_dropped(self, product):
        assert parse({"product": product}).product == ()


class Host:
    """The config endpoint, answering the payloads it was given in turn."""

    def __init__(self, *payloads: object):
        self.payloads = list(payloads)
        self.calls: list[str] = []
        self.asked_again = asyncio.Event()

    def transport(self) -> httpx.MockTransport:
        def handle(request: httpx.Request) -> httpx.Response:
            self.calls.append(str(request.url))
            if len(self.calls) > 1:
                self.asked_again.set()
            payload = self.payloads[min(len(self.calls), len(self.payloads)) - 1]
            if isinstance(payload, int):
                return httpx.Response(payload)
            return httpx.Response(200, json=payload)

        return httpx.MockTransport(handle)


def panel(host: Host, every_s: float = 60.0) -> RemotePanel:
    return RemotePanel("http://host", 1, every_s=every_s, transport=host.transport())


class TestKeepingItFresh:
    async def test_nothing_is_decided_until_the_host_has_answered(self):
        assert panel(Host(FULL)).current() == NOTHING_DECIDED

    async def test_one_fetch_lands_the_values_at_the_hosts_endpoint(self):
        host = Host(FULL)
        remote = panel(host)
        await remote.fetch()
        assert remote.current().model == "openai:answers"
        assert host.calls == ["http://host/api/agent/config"]

    async def test_a_failed_fetch_keeps_what_was_in_hand(self, caplog):
        remote = panel(Host(FULL, 500))
        await remote.fetch()
        with caplog.at_level(logging.WARNING, logger="svinooh-ai"):
            await remote.fetch()
        assert remote.current().model == "openai:answers", "the last good answer stands"
        assert "keeping the current values" in caplog.text

    async def test_a_change_is_logged_without_the_page_of_facts(self, caplog):
        remote = panel(Host(FULL))
        with caplog.at_level(logging.INFO, logger="svinooh-ai"):
            await remote.fetch()
        assert "agent config changed" in caplog.text
        assert "openai:answers" in caplog.text and "Bitcoin" not in caplog.text

    async def test_the_same_answer_again_is_not_news(self, caplog):
        remote = panel(Host(FULL))
        await remote.fetch()
        caplog.clear()
        with caplog.at_level(logging.INFO, logger="svinooh-ai"):
            await remote.fetch()
        assert "agent config changed" not in caplog.text

    async def test_keep_fresh_asks_again_until_cancelled(self):
        host = Host(FULL)
        refreshing = asyncio.create_task(panel(host, every_s=0.005).keep_fresh())
        await asyncio.wait_for(host.asked_again.wait(), timeout=2)
        refreshing.cancel()
        with pytest.raises(asyncio.CancelledError):
            await refreshing


class TestWhatATestCanSay:
    def test_values_are_plain_and_comparable(self):
        assert PanelValues(tool_hops=1) == PanelValues(tool_hops=1)
        assert PanelValues() == NOTHING_DECIDED
