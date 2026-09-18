"""The socket itself, because two deploys in a row died on it.

The service was serving and the healthcheck never reached it: the probe comes
from an IPv4 address, and a v6-only socket has nothing to say to one.
"""
import socket

from earn.api.serve import listening_socket


def test_an_ipv4_caller_is_accepted_too():
    server = listening_socket(0)
    port = server.getsockname()[1]
    try:
        assert server.getsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY) == 0
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            accepted, _ = server.accept()
            accepted.close()
    finally:
        server.close()
