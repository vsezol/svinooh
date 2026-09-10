"""What a portfolio IS, with nothing technical attached.

Frozen dataclasses and pure functions over them. The host's JSON becomes these
at the edge (app/adapters/wire.py), and everything above works in these terms
— so a field that moves on the wire is one mapper to change rather than forty
`.get()` calls to find, and a question like "what is in this portfolio" is
answered by a method rather than by a dict walk written twice.

Money is `float` rather than `Decimal`, deliberately: it arrives as a JSON
number, is only ever summed to be displayed, and is rounded to cents by the
renderer. Decimal would buy an exactness this service never spends.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Literal

#: The periods the product's own charts use, and therefore the only ones a
#: history question can be about.
Period = Literal["1h", "24h", "7d", "30d", "all"]

#: How wide each period actually is. The API answers a period with a series
#: reaching back several of them, so a chart has somewhere to scroll to, which
#: means its first point is not the start of the period asked for. "Over the
#: last week" has to mean the same thing in the chat as on the page.
WINDOW_MS: dict[str, int | None] = {
    "1h": 3_600_000,
    "24h": 24 * 3_600_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
    "all": None,
}

#: What a position held plainly in the wallet says its platform is.
WALLET = "wallet"


@dataclass(frozen=True)
class Leg:
    """One side of a position: what was supplied, or what was borrowed."""

    symbol: str
    #: "supply" or "borrow" — anything else is the source's own word for it.
    role: str
    value_usd: float
    amount: float | None = None
    price_usd: float | None = None


@dataclass(frozen=True)
class Band:
    """The pool a liquidity position sits in, and what it costs to trade there."""

    pair: str
    fee_pct: float | None = None


@dataclass(frozen=True)
class Position:
    """One holding: a token, a pool, a loan."""

    symbol: str
    value_usd: float
    name: str | None = None
    #: The network as the source names it: eth, arb, base, sol, tron, btc.
    network: str | None = None
    #: The protocol, or "wallet" when it is simply held. See `protocol`.
    platform: str | None = None
    category: str | None = None
    amount: float | None = None
    price_usd: float | None = None
    #: Yield and debt cost as fractions: 0.42 is 42%.
    apy: float | None = None
    borrow_apy: float | None = None
    #: A lending position's safety margin; below 1 is liquidation.
    health_rate: float | None = None
    #: Whether a liquidity position's price is inside its band: "in" / "out".
    range: str | None = None
    band: Band | None = None
    legs: tuple[Leg, ...] = ()

    @property
    def protocol(self) -> str | None:
        """The protocol this sits in, or None when it is simply held.

        "wallet" is not a protocol, and counting it as one made the "where is
        my money" line answer with the wallet it is already grouped by.
        """
        return self.platform if self.platform and self.platform != WALLET else None

    def matches(self, needle: str) -> bool:
        """Whether a one-word search names this position.

        Matched on everything a person calls a position by, not the symbol
        alone: "uniswap" found nothing in a portfolio holding three Uniswap
        pools, because the protocol is in `platform` and nobody asks about a
        pool by its LP token symbol.
        """
        haystack = " ".join(
            word
            for word in (self.symbol, self.name, self.platform, self.network, self.category)
            if word
        )
        return needle in haystack.lower()


@dataclass(frozen=True)
class Wallet:
    """One address, and everything found on it."""

    address: str
    chain: str
    status: str
    positions: tuple[Position, ...] = ()
    total_usd: float | None = None
    #: The last successful scan is older than three refresh intervals.
    stale: bool = False

    @property
    def largest_first(self) -> tuple[Position, ...]:
        """Sorted here rather than trusted from the wire, so a cap can only
        ever drop the tail — which is dust by construction."""
        return tuple(sorted(self.positions, key=lambda p: -p.value_usd))


@dataclass(frozen=True)
class Total:
    """What one group of positions is worth: a row of a breakdown."""

    label: str
    usd: float


@dataclass(frozen=True)
class Match:
    """A position a search found, and the wallet it was found on."""

    address: str
    position: Position


@dataclass(frozen=True)
class Portfolio:
    """A group of wallets under one slug — what the agent is asked about."""

    slug: str
    total_usd: float
    name: str | None = None
    wallets: tuple[Wallet, ...] = ()

    @property
    def title(self) -> str:
        """What to call it: its name, or the slug that stands in for one."""
        return self.name or self.slug

    @property
    def positions(self) -> tuple[Position, ...]:
        """Every position on every wallet."""
        return tuple(p for wallet in self.wallets for p in wallet.positions)

    @property
    def protocols(self) -> tuple[str, ...]:
        """The protocols this portfolio has money in, named once each."""
        return tuple(sorted({p.protocol for p in self.positions if p.protocol}))

    def totals_by(self, of: Callable[[Position], str | None]) -> tuple[Total, ...]:
        """Value grouped by one fact about a position, largest first.

        Computed over EVERY position rather than the few a context block
        prints: this is what makes "where is my money by chain" answerable
        without guessing, however long the tail is. A position the grouping
        cannot name is left out rather than bucketed under a made-up label.
        """
        sums: dict[str, float] = {}
        for position in self.positions:
            label = of(position)
            if label:
                sums[label] = sums.get(label, 0.0) + position.value_usd
        return tuple(
            Total(label=label, usd=usd)
            for label, usd in sorted(sums.items(), key=lambda row: -row[1])
        )

    def matching(self, query: str) -> tuple[Match, ...]:
        """Every position a one-word search names, largest first."""
        needle = query.strip().lower()
        if not needle:
            return ()
        found = [
            Match(address=wallet.address, position=position)
            for wallet in self.wallets
            for position in wallet.positions
            if position.matches(needle)
        ]
        return tuple(sorted(found, key=lambda m: -m.position.value_usd))


@dataclass(frozen=True)
class Reading:
    """One recorded total, and when it was taken.

    `at` is the timestamp exactly as the host wrote it, because that string is
    quoted back in an answer; `epoch_ms` is the same moment as a number, parsed
    once at the edge so the windowing arithmetic is a comparison. None means
    the timestamp could not be read, and a reading nobody can place in time is
    outside every window.
    """

    at: str
    usd: float
    epoch_ms: float | None = None


@dataclass(frozen=True)
class Change:
    """What a period did: the arithmetic half of a history answer.

    Computed here rather than by the model, over the full series, so the
    figures in an answer are Python's and not an LLM's.
    """

    period: str
    readings: tuple[Reading, ...]

    @property
    def first(self) -> Reading:
        return self.readings[0]

    @property
    def last(self) -> Reading:
        return self.readings[-1]

    @property
    def low(self) -> Reading:
        return min(self.readings, key=lambda r: r.usd)

    @property
    def high(self) -> Reading:
        return max(self.readings, key=lambda r: r.usd)

    @property
    def delta(self) -> float:
        return self.last.usd - self.first.usd

    @property
    def percent(self) -> float:
        # A portfolio that started at nothing grew by an undefined amount, and
        # saying 0% is the one answer that cannot mislead into a number.
        return (self.delta / self.first.usd * 100) if self.first.usd else 0.0


@dataclass(frozen=True)
class History:
    """A portfolio's recorded totals over time, oldest first."""

    range: str
    readings: tuple[Reading, ...] = ()

    def window(self, period: str) -> "History":
        """The readings inside a period, counted back from the last one."""
        width = WINDOW_MS.get(period)
        if width is None or not self.readings:
            return self
        last = self.readings[-1].epoch_ms
        if last is None:
            return self
        opens = last - width
        inside = tuple(r for r in self.readings if (r.epoch_ms or 0) >= opens)
        # Fewer than two readings inside says nothing about a change, and the
        # whole series at least says something true about a longer one.
        return History(range=self.range, readings=inside) if len(inside) >= 2 else self

    def change(self, period: str) -> Change | None:
        """What that period did, or None when too little was recorded to say."""
        inside = self.window(period).readings
        return Change(period=period, readings=inside) if len(inside) >= 2 else None


@dataclass(frozen=True)
class PortfolioRef:
    """A portfolio as the host names it when listing what somebody owns."""

    slug: str
    name: str | None = None


@dataclass(frozen=True)
class Me:
    """Who the caller is, and what they own — the host's one identity answer."""

    user_id: str
    portfolios: tuple[PortfolioRef, ...] = ()


def total_of(positions: Iterable[Position]) -> float:
    """What a handful of positions is worth together."""
    return sum(position.value_usd for position in positions)
