"""Serving: one socket, both address families — the healthcheck calls over IPv4."""
from __future__ import annotations

import logging
import os
import socket

import uvicorn

from earn.api.app import create_app
from earn.infrastructure import logging as log_setup

log = logging.getLogger(__name__)

DEFAULT_PORT = 3000


def listening_socket(port: int) -> socket.socket:
    return socket.create_server(("::", port), family=socket.AF_INET6, dualstack_ipv6=True)


def main() -> None:
    log_setup.configure()
    port = int(os.environ.get("PORT") or DEFAULT_PORT)
    log.info("serving on [::]:%d, IPv4 callers included", port)
    uvicorn.Server(uvicorn.Config(create_app, factory=True)).run(sockets=[listening_socket(port)])


if __name__ == "__main__":
    main()
