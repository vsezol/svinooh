"""Everything this service knows about Redis, and the only place it does.

Two things live on the same instance — conversations and the rate limiter's
counters — and both reach it through the single client in client.py, so the
service opens one connection pool rather than one per feature.
"""
