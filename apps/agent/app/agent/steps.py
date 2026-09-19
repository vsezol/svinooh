import logging
import time
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar

from langgraph.config import get_stream_writer

logger = logging.getLogger("svinooh-ai")

_running: ContextVar[dict | None] = ContextVar("running_step", default=None)


def said(detail: str) -> None:
    box = _running.get()
    if box is not None:
        box["detail"] = detail


def _writer():
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
    with _timed(key, label):
        yield


def tool_label(name: str, args: dict) -> str:
    values = [str(value) for value in args.values() if value not in (None, "")]
    return f"{name} · {', '.join(values)}" if values else name
