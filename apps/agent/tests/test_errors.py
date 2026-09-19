import pathlib

import pytest

from app.domain.errors import UnknownTokenError
from tests.support import Meter, client_for, container


class Rejecting:
    async def authenticate(self, _token: str | None):
        raise UnknownTokenError


class TestWhatARefusalLooksLike:
    async def test_a_message_with_nothing_in_it_is_a_400(self):
        async with client_for(container()) as client:
            response = await client.post("/chat", json={"message": "   "})
        assert response.status_code == 400
        assert response.json() == {"detail": "empty message"}

    async def test_a_token_the_host_rejects_is_a_401(self):
        async with client_for(container(door=Rejecting())) as client:
            response = await client.post(
                "/chat", json={"message": "hello"}, headers={"authorization": "Bearer stale"}
            )
        assert response.status_code == 401
        assert response.json() == {"detail": "unknown token"}

    async def test_a_spent_budget_is_a_429_carrying_the_wait(self):
        meter = Meter()
        meter.wait = 42
        async with client_for(container(limiter=meter)) as client:
            response = await client.post("/chat", json={"message": "hello"})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "42"

    async def test_a_conversation_that_is_not_yours_is_a_404(self):
        async with client_for(container()) as client:
            response = await client.get("/chats/nobodys")
        assert response.status_code == 404
        assert response.json() == {"detail": "no such conversation"}

    async def test_the_stream_refuses_before_it_opens(self):
        async with client_for(container()) as client:
            response = await client.post("/chat/stream", json={"message": " "})
        assert response.status_code == 400
        assert "text/event-stream" not in response.headers.get("content-type", "")


class TestTheLayeringThisRestsOn:
    @staticmethod
    def _sources(package: str) -> list[tuple[str, str]]:
        root = pathlib.Path(__file__).parent.parent / "app" / package
        return [(str(p), p.read_text()) for p in root.rglob("*.py")]

    @pytest.mark.parametrize("forbidden", ["fastapi", "httpx", "langchain", "pydantic", "redis"])
    def test_the_domain_names_nothing_technical(self, forbidden):
        for name, source in self._sources("domain"):
            assert f"import {forbidden}" not in source, f"{name} imports {forbidden}"

    @pytest.mark.parametrize("forbidden", ["fastapi", "httpx"])
    def test_the_use_cases_name_neither_the_web_nor_the_wire(self, forbidden):
        for name, source in self._sources("application"):
            assert f"import {forbidden}" not in source, f"{name} imports {forbidden}"
