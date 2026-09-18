"""Serving: one socket, both address families.

Railway probes `/health` from an IPv4 address and its private network resolves
only AAAA, so this service has to answer on both. A `::` socket does that once
IPV6_V6ONLY is off — it is on by default in the container, which is why the
probe never arrived and a build that was serving fine never went live.
"""
from __future__ import annotations

import logging
import os
import socket

import uvicorn

from earn.api.app import create_app

#: What the other services use; Railway injects PORT over it.
DEFAULT_PORT = 3000


def listening_socket(port: int) -> socket.socket:
    """Bound and listening, to IPv6 and IPv4 callers alike."""
    return socket.create_server(("::", port), family=socket.AF_INET6, dualstack_ipv6=True)


def main() -> None:
    port = int(os.environ.get("PORT") or DEFAULT_PORT)
    config = uvicorn.Config(create_app, factory=True)
    logging.getLogger("uvicorn").info("serving on [::]:%d, IPv4 callers included", port)
    uvicorn.Server(config).run(sockets=[listening_socket(port)])


if __name__ == "__main__":
    main()
