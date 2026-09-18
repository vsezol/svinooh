"""What the service is doing, reported by the code that is doing it.

A person waiting on a spinner is being kept; a person watching work they can
see is waiting on something. So a turn says what it is up to — routing the
question, reading the portfolio, calling this tool with that argument — and
each line carries how long it took.

The rule that makes it worth having: a step exists because an operation runs,
and it is reported by that operation. Nothing here invents a plausible-looking
list of things an assistant might be doing. If a line is on screen, that call
was made; if a call is made and nobody wrapped it, no line appears. The failure
mode is silence, never fiction.

Reporting is best-effort by construction. `get_stream_writer` only has
somewhere to write when the turn is being streamed; on the plain /chat path,
and in tests, there is no writer and `step` is an ordinary timer that tells
nobody. That is why every node can use it without asking which path it is on.
"""

import logging
import time
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar

from langgraph.config import get_stream_writer

logger = logging.getLogger("svinooh-ai")

_running: ContextVar[dict | None] = ContextVar("running_step", default=None)


def said(detail: str) -> None:
    """What the operation running right now found, closed onto its own line.

    Called by the operation itself, once it knows: eight pools, fourteen
    positions. Outside a step it does nothing, which is what lets a tool report
    without knowing whether anybody is watching.
    """
    box = _running.get()
    if box is not None:
        box["detail"] = detail


def _writer():
    """The channel to the reader, or None when nobody is watching."""
    try:
        return get_stream_writer()
    except Exception:  # noqa: BLE001 — outside a graph run there is simply no channel
        return None


def _say(event: dict) -> None:
    write = _writer()
    if write is None:
        return
    try:
        write(event)
    except Exception as error:  # noqa: BLE001 — a broken pipe must not fail the turn
        logger.debug("step not reported (%r)", error)


@contextmanager
def _timed(key: str, label: str):
    """The shared body: announce, time, and close with what actually happened."""
    _say({"id": key, "label": label, "state": "running"})
    found: dict = {}
    token = _running.set(found)
    started = time.monotonic()
    try:
        yield
    except Exception:
        _say({"id": key, "state": "failed", "ms": _ms(started), **found})
        raise
    finally:
        _running.reset(token)
    _say({"id": key, "state": "done", "ms": _ms(started), **found})


def _ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


@asynccontextmanager
async def step(key: str, label: str):
    """Report one operation for as long as it runs.

    `key` identifies the line so a later update lands on it rather than adding
    a second; `label` is what the reader sees and should name the operation in
    the words the operation would use about itself.
    """
    with _timed(key, label):
        yield


def tool_label(name: str, args: dict) -> str:
    """A tool call, said the way it was made.

    The name is the tool's own and the argument is the one that was passed, so
    the line cannot describe something other than what ran. Shown rather than
    prettified for the same reason a terminal shows the command: the point is
    that you can check it.
    """
    values = [str(value) for value in args.values() if value not in (None, "")]
    return f"{name} · {', '.join(values)}" if values else name
