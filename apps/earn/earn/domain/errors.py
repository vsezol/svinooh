"""The one base every failure of ours descends from.

Having a single root is what lets the api layer translate *our* failures into
problem documents and let everything else — a bug, an upstream client blowing
up — surface as the 500 it is, instead of being flattened into a polite 400.
"""


class EarnError(Exception):
    """Something this service could not do. Never raised directly."""
