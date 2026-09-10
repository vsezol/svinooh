"""Log lines a machine can read, and a turn a person can follow.

Two problems, and the second hid behind the first.

Nothing configures logging under uvicorn except uvicorn's own loggers, so a
message from `svinooh-ai` fell through to logging's last-resort handler —
which prints WARNING and above and drops everything below. That is why the
routing decisions, the tool calls and the created portfolios were invisible
while their failures were not.

Then every line that did arrive was marked an error, because Python logs to
stderr and the platform reads a stream as a severity. A routing decision and
a refused endpoint looked identical, so "show me the errors" showed
everything, which is the same as showing nothing. Ordinary lines go to stdout
now and warnings and above to stderr, which is the convention the platform
reads.

And a third, which JSON is for: one turn writes half a dozen lines — the
intent, the account check, each tool call, the portfolio it created — and
under any load they arrive interleaved with everybody else's. Every line
carries the id of the request that produced it, so one turn can be read back
out of a busy log.
"""

import json
import logging
import os
import sys
from contextvars import ContextVar

#: The request being served on this task, for whatever logs while it runs.
#: Empty outside a request — a background refresh belongs to nobody.
request_id: ContextVar[str] = ContextVar("request_id", default="")

#: What logging puts on a record before anyone adds anything of their own.
_BUILT_IN = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


class JsonFormatter(logging.Formatter):
    """One line, one object. The message stays readable inside it.

    The platform parses these and shows `level` and `message` as fields, so
    filtering by severity stops depending on which stream a line came out of
    — while the streams stay split anyway, because that is what the platform
    falls back on.
    """

    def __init__(self, service: str) -> None:
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        line = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "service": self.service,
        }
        current = request_id.get()
        if current:
            line["request_id"] = current
        if record.exc_info:
            line["exception"] = self.formatException(record.exc_info)
        # Anything a caller passed as `extra=`, without the machinery.
        line.update({key: value for key, value in record.__dict__.items() if key not in _BUILT_IN})
        return json.dumps(line, ensure_ascii=False, default=str)


class _Below(logging.Filter):
    """Records under a level — the half that belongs on stdout."""

    def __init__(self, level: int) -> None:
        super().__init__()
        self.level = level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno < self.level


def configure() -> None:
    """Send this service's lines to the right stream, in the right shape."""
    formatter = JsonFormatter(os.getenv("SERVICE_NAME", "agent"))
    ordinary = logging.StreamHandler(sys.stdout)
    ordinary.addFilter(_Below(logging.WARNING))
    ordinary.setFormatter(formatter)
    # The two halves have to be exclusive at both ends. A handler with no
    # level takes everything, so without this the ordinary lines would go out
    # on both streams — and one event logged twice is two events to whoever
    # counts them.
    bad = logging.StreamHandler(sys.stderr)
    bad.setLevel(logging.WARNING)
    bad.setFormatter(formatter)
    logging.basicConfig(level=logging.INFO, handlers=[ordinary, bad], force=True)
    # Uvicorn keeps its own handlers, which are all on stderr; letting the root
    # handlers have the records too is what puts its access lines on the right
    # stream, and turning propagation off would be the reverse of the fix.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers.clear()
    # One line per model call, times every turn, drowns the decisions.
    #
    # Two names, because there are two clients. Ours is `httpx`; the model
    # libraries bring `httpx2`, a separate package with a logger of its own,
    # and silencing only the first left production writing an INFO line for
    # every call to OpenRouter — the exact noise this line exists to stop.
    for chatty in ("httpx", "httpx2"):
        logging.getLogger(chatty).setLevel(logging.WARNING)
