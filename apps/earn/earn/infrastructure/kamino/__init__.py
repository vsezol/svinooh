"""Kamino, on Solana — the first `YieldSource`.

Split three ways on purpose: `api` speaks HTTP and knows Kamino's URLs,
`mapping` turns Kamino's payloads into our model and knows Kamino's field
names, and `source` is the port implementation that puts them together. When
Kamino renames a field, exactly one of these three files changes.
"""
