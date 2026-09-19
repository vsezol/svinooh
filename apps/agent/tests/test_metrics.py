import httpx
import pytest
from prometheus_client import Counter

from app.agent.tools import run_tools
from app.observability import metrics
from tests import fixtures as fx
from tests.support import client_for, container, fake_model


def reading(metric: Counter, **labels: str) -> float:
    value = metrics.registry.get_sample_value(
        f"{metric._name}_total", {"app": metrics._APP, **labels}
    )
    return value or 0.0


@pytest.fixture
async def client():
    async with client_for(container(model=fake_model("answered"))) as client:
        yield client


class TestEveryRequestIsCounted:
    async def test_a_request_is_counted_under_its_route_template(self, client):
        before = reading(
            metrics.http_requests, method="GET", route="/chats/{chat_id}", status="404"
        )
        await client.get("/chats/nobodys")
        await client.get("/chats/somebody-elses")
        after = reading(metrics.http_requests, method="GET", route="/chats/{chat_id}", status="404")
        assert after - before == 2, "two conversations, one series"

    async def test_a_path_nobody_routed_is_not_a_series_of_its_own(self, client):
        before = reading(metrics.http_requests, method="GET", route="unmatched", status="404")
        await client.get("/definitely-not-a-route")
        after = reading(metrics.http_requests, method="GET", route="unmatched", status="404")
        assert after - before == 1

    async def test_the_time_is_measured_too(self, client):
        await client.get("/health")
        counted = metrics.registry.get_sample_value(
            "svinooh_http_request_duration_seconds_count",
            {"app": metrics._APP, "method": "GET", "route": "/health", "status": "200"},
        )
        assert counted and counted >= 1


class TestATurnIsCounted:
    async def test_an_answered_turn_says_so(self, client):
        before = reading(metrics.turns, outcome="answered")
        await client.post("/chat", json={"message": "hello"})
        assert reading(metrics.turns, outcome="answered") - before == 1

    async def test_and_the_model_calls_it_made(self, client):
        before = reading(metrics.model_calls, role="answering", outcome="ok")
        await client.post("/chat", json={"message": "hello"})
        assert reading(metrics.model_calls, role="answering", outcome="ok") - before >= 1

    async def test_a_turn_that_ends_in_a_door_is_not_an_answer(self):
        from tests.support import Purse

        purse = Purse(questions=0)
        before = reading(metrics.turns, outcome="walled")
        async with client_for(container(allowance=purse)) as walled:
            await walled.post("/chat", json={"message": "hello"})
        assert reading(metrics.turns, outcome="walled") - before == 1

    async def test_the_routing_decision_is_counted_apart_from_its_fail_safe(self):
        before = reading(metrics.intents, intent="general")
        async with client_for(container(model=fake_model("answered"))) as client:
            await client.post("/chat", json={"message": "what is impermanent loss?"})
        assert reading(metrics.intents, intent="general") - before == 1


class TestNoLabelIsTheModelsToInvent:
    async def test_a_tool_that_exists_is_counted_by_name(self):
        tools = __import__("app.agent.tools", fromlist=["portfolio_tools"]).portfolio_tools(
            None, "p", None, fx.as_portfolio()
        )
        before = reading(metrics.tool_calls, tool="position_details", outcome="ok")
        await run_tools([{"name": "position_details", "args": {"query": "eth"}, "id": "a"}], tools)
        assert reading(metrics.tool_calls, tool="position_details", outcome="ok") - before == 1

    async def test_one_the_model_made_up_is_counted_as_unknown(self):
        before = reading(metrics.tool_calls, tool="unknown", outcome="failed")
        await run_tools([{"name": "definitely_not_a_tool", "args": {}, "id": "b"}], [])
        assert reading(metrics.tool_calls, tool="unknown", outcome="failed") - before == 1
        assert reading(metrics.tool_calls, tool="definitely_not_a_tool", outcome="failed") == 0


class TestTheScrape:
    async def test_it_answers_in_the_format_prometheus_reads(self, client):
        response = await client.get("/metrics")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")

    async def test_and_carries_this_services_own_instruments(self, client):
        await client.post("/chat", json={"message": "hello"})
        body = (await client.get("/metrics")).text
        assert "svinooh_agent_turns_total" in body
        assert "svinooh_agent_model_duration_seconds" in body
        assert "svinooh_http_requests_total" in body

    async def test_every_series_says_which_service_it_came_from(self, client):
        await client.get("/health")
        body = (await client.get("/metrics")).text
        counted = [
            line for line in body.splitlines() if line.startswith("svinooh_http_requests_total{")
        ]
        assert counted and all('app="' in line for line in counted)


class TestOneTurnCanBeReadBack:
    @staticmethod
    async def _ids(times: int) -> list[str]:
        from app import create_app
        from app.observability.logs import request_id

        app = create_app(container())

        @app.get("/whose-turn")
        def whose() -> dict:
            return {"id": request_id.get()}

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://agent"
        ) as client:
            return [(await client.get("/whose-turn")).json()["id"] for _ in range(times)]

    async def test_a_handler_can_say_whose_request_it_is_serving(self):
        assert all(await self._ids(1)), "a request with no id cannot be read back"

    async def test_and_no_two_requests_share_one(self):
        ids = await self._ids(3)
        assert len(set(ids)) == 3
