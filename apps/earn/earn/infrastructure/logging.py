"""Logging, set up once, at the edge.

stdout rather than the default stderr: Railway reads the stream a line arrived
on as its severity, so logging INFO to stderr paints every ordinary line red
and leaves nothing to notice when something is actually wrong.
"""
from __future__ import annotations

import logging
import os
import sys


def configure() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )
    # httpx logs a line per request at INFO. A refresh makes forty-five of them
    # every five minutes, burying the one line that says what it produced.
    logging.getLogger("httpx").setLevel(logging.WARNING)
