import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

import httpx

WORLDS = Path(__file__).parent / "worlds"

ADDRESS = "http://world"


class World:
    def __init__(self, answers: dict[str, Any], failures: dict[str, int] | None = None) -> None:
        self._answers = answers
        self._failures = failures or {}
        self.asked: list[str] = []

    @classmethod
    def named(cls, name: str) -> "World":
        recorded = json.loads((WORLDS / f"{name}.json").read_text())
        return cls(recorded["answers"], recorded.get("failures"))

    @property
    def writes(self) -> list[str]:
        return [asked for asked in self.asked if not asked.startswith("GET ")]

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.answer))

    def answer(self, request: httpx.Request) -> httpx.Response:
        route = f"{request.method} {request.url.path}"
        self.asked.append(route)
        params = dict(parse_qsl(request.url.query.decode()))
        if route in self._failures:
            return httpx.Response(self._failures[route], json={"message": "down"})
        key = most_specific(route, params, self._answers)
        if key is None:
            return httpx.Response(404, json={"message": "not found"})
        return httpx.Response(200, json=self._answers[key])


def most_specific(route: str, params: dict[str, str], answers: dict[str, Any]) -> str | None:
    fitting = []
    for key in answers:
        recorded_route, _, query = key.partition("?")
        wanted = dict(parse_qsl(query))
        if recorded_route == route and all(params.get(k) == v for k, v in wanted.items()):
            fitting.append((len(wanted), key))
    return max(fitting)[1] if fitting else None
