"""Orchestration: the ports the outside must fit through, and the use cases.

This layer knows the domain and knows nothing else. It does not know that pools
come from Kamino over HTTP, or that answers leave over HTTP — it knows there is
a `YieldSource` and that somebody will ask it questions.
"""
