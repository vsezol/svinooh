"""Which stream a log line goes out on, and why that decides anything.

The platform reads a stream as a severity. Python logs everything to stderr,
so every line this service wrote was filed as an error: a routing decision and
a refused endpoint looked the same, "show me the errors" showed all of it, and
two production outages this week sat in plain sight in a list where nothing
stood out.
"""

import io
import logging
import sys

import pytest

from app import _configure_logging


@pytest.fixture
def streams(monkeypatch):
    """Configure logging against streams we can read back.

    The handlers capture whatever sys.stdout and sys.stderr are when they are
    built, so the swap has to happen first — and then what a line does is a
    fact about the output rather than about the handler list.
    """
    out, err = io.StringIO(), io.StringIO()
    monkeypatch.setattr(sys, "stdout", out)
    monkeypatch.setattr(sys, "stderr", err)
    _configure_logging()
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
        # One event logged twice is two events to whoever counts them.
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
        # The bug this replaced: INFO fell below the last-resort handler and
        # every routing decision vanished.
        out, _ = streams
        say(logging.INFO, "identity: no token")
        assert "identity: no token" in out.getvalue()

    def test_the_http_client_is_kept_quiet(self, streams):
        # One line per model call, times every turn, drowns the decisions.
        out, err = streams
        logging.getLogger("httpx").info("HTTP Request: POST ...")
        assert out.getvalue() == "" and err.getvalue() == ""

    def test_but_its_failures_are_not(self, streams):
        _, err = streams
        logging.getLogger("httpx").warning("connect timeout")
        assert "connect timeout" in err.getvalue()

    def test_uvicorn_is_left_to_the_root_handlers(self, streams):
        # Its own handlers are all on stderr; leaving them attached would put
        # its access lines back where they were.
        out, _ = streams
        logging.getLogger("uvicorn.access").info("GET /health 200")
        assert "GET /health 200" in out.getvalue()
