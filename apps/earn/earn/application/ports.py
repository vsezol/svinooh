"""The seams. Everything the outside world reaches this service through.

A port is written from the *inside*: it says what the application needs, in the
application's words, and it is infrastructure's problem to fit. That is the
whole trick — `KaminoSource` exists to satisfy `YieldSource`, not the other way
round, so a second protocol is a new class here and no change anywhere else.
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Protocol, runtime_checkable

from earn.domain.pool import Pool


@runtime_checkable
class YieldSource(Protocol):
    """Somewhere that pays for a single-token deposit.

    Implementations own their upstream's quirks — pagination, naming, which
    field is really the rate — and export none of them.
    """

    @property
    def name(self) -> str:
        """For logs and for `meta.degraded`: which source could not be read."""
        ...

    async def fetch(self) -> Sequence[Pool]:
        """Every pool this source knows about, already in our model.

        Raising is allowed and expected: one source failing must not be able to
        empty the catalog, and the refresher is what makes that true.
        """
        ...


class Clock(Protocol):
    """Now, as an injectable fact.

    A port for the same reason the network is one: staleness is a rule with a
    threshold, and a rule you cannot test without waiting is a rule nobody
    tests.
    """

    def __call__(self) -> datetime: ...
