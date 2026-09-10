"""The outside world, one module per thing we talk to.

Everything that speaks a protocol somebody else defined lives here — Redis, the
portfolio API. Each one implements a port from app/ports.py, so the layers
above name the port and never the vendor, and swapping Redis for a database or
an HTTP service is a new module in here plus one line in the composition root.
"""
