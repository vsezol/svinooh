import json
import logging
import os
import sys
from contextvars import ContextVar

request_id: ContextVar[str] = ContextVar("request_id", default="")

_BUILT_IN = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


class JsonFormatter(logging.Formatter):
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
        line.update({key: value for key, value in record.__dict__.items() if key not in _BUILT_IN})
        return json.dumps(line, ensure_ascii=False, default=str)


class _Below(logging.Filter):
    def __init__(self, level: int) -> None:
        super().__init__()
        self.level = level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno < self.level


def configure() -> None:
    formatter = JsonFormatter(os.getenv("SERVICE_NAME", "agent"))
    ordinary = logging.StreamHandler(sys.stdout)
    ordinary.addFilter(_Below(logging.WARNING))
    ordinary.setFormatter(formatter)
    bad = logging.StreamHandler(sys.stderr)
    bad.setLevel(logging.WARNING)
    bad.setFormatter(formatter)
    logging.basicConfig(level=logging.INFO, handlers=[ordinary, bad], force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers.clear()
    for chatty in ("httpx", "httpx2"):
        logging.getLogger(chatty).setLevel(logging.WARNING)
