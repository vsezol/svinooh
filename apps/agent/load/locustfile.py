"""The people asking, and what each of them costs us.

Three shapes, because they cost different things. A general question is one
model call. A grounded one adds a portfolio fetch, a big payload to parse and
a context block to render, and often a tool hop on top. A watched turn is the
same work delivered as it happens, which is where a buffering middleware or a
connection held too long would show.

Every user carries its own browser id, so conversations spread across the
store the way real ones do rather than piling into one key.

    uv run locust -f load/locustfile.py --host http://127.0.0.1:9098 \
      --headless -u 50 -r 10 -t 60s

See load/README.md for what has to be running, and for what the numbers were
the last time this was taken seriously.
"""

import time
import uuid

from locust import HttpUser, between, events, task

GENERAL = "What is impermanent loss, briefly?"
GROUNDED = "How did this portfolio move this week, and where is the money?"
PORTFOLIO = "load-pf"


class Reader(HttpUser):
    """One person with a chat open."""

    wait_time = between(0.5, 2)

    def on_start(self) -> None:
        # A browser id of its own: the store keys on it, and one id for
        # everybody would measure a single conversation being appended to.
        self.anon = f"load{uuid.uuid4().hex}"

    @property
    def _headers(self) -> dict[str, str]:
        return {"content-type": "application/json", "X-Svinooh-Anon-Id": self.anon}

    @task(3)
    def a_general_question(self) -> None:
        self.client.post(
            "/chat",
            json={"message": GENERAL},
            headers=self._headers,
            name="POST /chat (general)",
        )

    @task(3)
    def a_grounded_question(self) -> None:
        self.client.post(
            "/chat",
            json={"message": GROUNDED, "portfolio": PORTFOLIO},
            headers=self._headers,
            name="POST /chat (grounded)",
        )

    @task(2)
    def a_watched_turn(self) -> None:
        """The stream, timed twice: to the first event, and to the last.

        The first is what a reader experiences as the chat waking up; the
        second is the turn. Locust would otherwise record the moment the
        headers arrived, which for a stream is neither.
        """
        started = time.perf_counter()
        first: float | None = None
        size = 0
        try:
            with self.client.post(
                "/chat/stream",
                json={"message": GROUNDED, "portfolio": PORTFOLIO},
                headers=self._headers,
                stream=True,
                catch_response=True,
                name="POST /chat/stream",
            ) as response:
                for line in response.iter_lines():
                    if not line:
                        continue
                    size += len(line)
                    if first is None:
                        first = time.perf_counter()
                response.success()
        except Exception as error:  # noqa: BLE001 — a failed turn is a data point
            _fire("stream: whole turn", started, size, error)
            return
        if first is not None:
            _fire("stream: first event", started, 0, None, at=first)
        _fire("stream: whole turn", started, size, None)


def _fire(
    name: str,
    started: float,
    size: int,
    error: Exception | None,
    at: float | None = None,
) -> None:
    events.request.fire(
        request_type="SSE",
        name=name,
        response_time=((at or time.perf_counter()) - started) * 1000,
        response_length=size,
        exception=error,
    )
