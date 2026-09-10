"""Where pools come from.

A source is one async function: given an HTTP client, return the pools it
knows about, already normalised into `domain.Pool`. It owns its upstream's
quirks — pagination, naming, which field is really the APY — and exports none
of them. Adding a protocol is adding a module here and a line in app/catalog.py.
"""
