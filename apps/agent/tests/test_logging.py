import io
import json
import logging
import sys

import pytest

from app.observability.logs import configure, request_id


@pytest.fixture
def streams(monkeypatch):
    out, err = io.StringIO(), io.StringIO()
    monkeypatch.setattr(sys, "stdout", out)
    monkeypatch.setattr(sys, "stderr", err)
    configure()
    yield out, err
    logging.basicConfig(force=True)


def say(level: int, message: str) -> None:
    logging.getLogger("svinooh-ai").log(level, message)


class TestWhereALineGoes:
    def test_an_ordinary_line_goes_to_stdout_only(self, streams):
        out, err = streams
        say(logging.INFO, "intent: general")
        assert "intent: general" in out.getvalue()
        assert err.getvalue() == "", "a routing decision is not an error"

    def test_a_warning_goes_to_stderr_only(self, streams):
        out, err = streams
        say(logging.WARNING, "classifier failed")
        assert "classifier failed" in err.getvalue()
        assert out.getvalue() == "", "not on both streams"

    def test_and_so_does_an_error(self, streams):
        out, err = streams
        say(logging.ERROR, "everything is on fire")
        assert "everything is on fire" in err.getvalue()
        assert out.getvalue() == ""

    def test_the_level_is_still_in_the_line(self, streams):
        out, _ = streams
        say(logging.INFO, "created portfolio")
        assert "INFO" in out.getvalue(), "the stream is a hint, the level is the record"


class TestWhatIsStillHeard:
    def test_our_own_lines_are_not_dropped(self, streams):
        out, _ = streams
        say(logging.INFO, "identity: no token")
        assert "identity: no token" in out.getvalue()

    @pytest.mark.parametrize("client", ["httpx", "httpx2"])
    def test_the_http_clients_are_kept_quiet(self, streams, client):
        out, err = streams
        logging.getLogger(client).info("HTTP Request: POST ...")
        assert out.getvalue() == "" and err.getvalue() == ""

    @pytest.mark.parametrize("client", ["httpx", "httpx2"])
    def test_but_their_failures_are_not(self, streams, client):
        _, err = streams
        logging.getLogger(client).warning("connect timeout")
        assert "connect timeout" in err.getvalue()

    def test_uvicorn_is_left_to_the_root_handlers(self, streams):
        out, _ = streams
        logging.getLogger("uvicorn.access").info("GET /health 200")
        assert "GET /health 200" in out.getvalue()


def only_line(stream: io.StringIO) -> dict:
    written = [line for line in stream.getvalue().splitlines() if line.strip()]
    assert len(written) == 1, written
    return json.loads(written[0])


class TestTheShapeOfALine:
    def test_a_line_is_one_object(self, streams):
        out, _ = streams
        say(logging.INFO, "intent: general")
        line = only_line(out)
        assert line["message"] == "intent: general"
        assert line["level"] == "INFO" and line["logger"] == "svinooh-ai"

    def test_a_failure_carries_its_traceback(self, streams):
        _, err = streams
        try:
            raise RuntimeError("upstream is on fire")
        except RuntimeError:
            logging.getLogger("svinooh-ai").exception("turn failed")
        assert "RuntimeError: upstream is on fire" in only_line(err)["exception"]

    def test_what_a_caller_adds_survives(self, streams):
        out, _ = streams
        logging.getLogger("svinooh-ai").info("created", extra={"slug": "new-pf"})
        assert only_line(out)["slug"] == "new-pf"


class TestWhoseTurnItIs:
    def test_a_line_written_during_a_request_carries_its_id(self, streams):
        out, _ = streams
        token = request_id.set("abc123")
        try:
            say(logging.INFO, "intent: general")
        finally:
            request_id.reset(token)
        assert only_line(out)["request_id"] == "abc123"

    def test_and_one_written_outside_a_request_claims_nothing(self, streams):
        out, _ = streams
        say(logging.INFO, "agent config changed")
        assert "request_id" not in only_line(out)
