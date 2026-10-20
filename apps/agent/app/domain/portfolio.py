import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

Period = Literal["1h", "24h", "7d", "30d", "all"]

WINDOW_MS: dict[str, int | None] = {
    "1h": 3_600_000,
    "24h": 24 * 3_600_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
    "all": None,
}

WALLET = "wallet"


@dataclass(frozen=True)
class Leg:
    symbol: str
    role: str
    value_usd: float
    amount: float | None = None
    price_usd: float | None = None
    apy: float | None = None


@dataclass(frozen=True)
class Band:
    pair: str
    fee_pct: float | None = None


@dataclass(frozen=True)
class Position:
    symbol: str
    value_usd: float
    name: str | None = None
    network: str | None = None
    platform: str | None = None
    category: str | None = None
    amount: float | None = None
    price_usd: float | None = None
    apy: float | None = None
    borrow_apy: float | None = None
    health_rate: float | None = None
    range: str | None = None
    band: Band | None = None
    legs: tuple[Leg, ...] = ()
    fees_earned_usd: float | None = None

    @property
    def has_debt(self) -> bool:
        return bool(self.borrow_apy) or any(leg.role == "borrow" for leg in self.legs)

    @property
    def earning_legs(self) -> tuple[Leg, ...]:
        return tuple(leg for leg in self.legs if leg.role == "supply" and leg.apy is not None)

    @property
    def protocol(self) -> str | None:
        return self.platform if self.platform and self.platform != WALLET else None

    def matches(self, needle: str) -> bool:
        haystack = " ".join(
            word
            for word in (self.symbol, self.name, self.platform, self.network, self.category)
            if word
        )
        return re.search(rf"(?<![a-z0-9]){re.escape(needle)}", haystack.lower()) is not None


@dataclass(frozen=True)
class Wallet:
    address: str
    chain: str
    status: str
    positions: tuple[Position, ...] = ()
    total_usd: float | None = None
    stale: bool = False

    @property
    def largest_first(self) -> tuple[Position, ...]:
        return tuple(sorted(self.positions, key=lambda p: -p.value_usd))


@dataclass(frozen=True)
class Total:
    label: str
    usd: float


@dataclass(frozen=True)
class Match:
    address: str
    position: Position


@dataclass(frozen=True)
class Portfolio:
    slug: str
    total_usd: float
    name: str | None = None
    wallets: tuple[Wallet, ...] = ()

    @property
    def title(self) -> str:
        return self.name or self.slug

    @property
    def positions(self) -> tuple[Position, ...]:
        return tuple(p for wallet in self.wallets for p in wallet.positions)

    @property
    def protocols(self) -> tuple[str, ...]:
        return tuple(sorted({p.protocol for p in self.positions if p.protocol}))

    def totals_by(self, of: Callable[[Position], str | None]) -> tuple[Total, ...]:
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


STABLE_WITHOUT_USD = frozenset({"DAI", "SDAI", "XDAI", "GHO", "FRAX", "MIM", "BOLD"})

_PRINCIPAL_TOKEN = re.compile(r"^PT-([^-]+)")
_ONE_WORD = re.compile(r"^[A-Z0-9]+$")

ZERO = Decimal(0)


def is_stablecoin(symbol: str) -> bool:
    name = symbol.strip().upper().replace("₮", "T").replace(".", "")
    principal = _PRINCIPAL_TOKEN.match(name)
    if principal:
        name = principal.group(1)
    return bool(_ONE_WORD.match(name)) and ("USD" in name or name in STABLE_WITHOUT_USD)


@dataclass(frozen=True)
class Side:
    held: Decimal = ZERO
    owed: Decimal = ZERO

    @property
    def net(self) -> Decimal:
        return self.held - self.owed

    def plus(self, held: Decimal = ZERO, owed: Decimal = ZERO) -> "Side":
        return Side(self.held + held, self.owed + owed)


@dataclass(frozen=True)
class Exposure:
    stable: Side
    volatile: Side
    by_token: tuple[tuple[str, Side], ...]
    stable_in: tuple[tuple[str, Side], ...]
    unsplit: tuple[tuple[str, Decimal], ...]

    @property
    def unsplit_usd(self) -> Decimal:
        return sum((usd for _, usd in self.unsplit), ZERO)

    @property
    def total(self) -> Decimal:
        return self.stable.net + self.volatile.net + self.unsplit_usd


def exposure_of(positions: Iterable[Position], label: Callable[[Position], str]) -> Exposure:
    stable, volatile = Side(), Side()
    tokens: dict[str, Side] = {}
    stable_in: dict[str, Side] = {}
    unsplit: list[tuple[str, Decimal]] = []
    for position in positions:
        legs = position.legs or _as_one_leg(position)
        if not legs:
            unsplit.append((label(position), Decimal(str(position.value_usd))))
            continue
        for leg in legs:
            usd = abs(Decimal(str(leg.value_usd)))
            held, owed = (ZERO, usd) if leg.role == "borrow" else (usd, ZERO)
            tokens[leg.symbol] = tokens.get(leg.symbol, Side()).plus(held, owed)
            if is_stablecoin(leg.symbol):
                stable = stable.plus(held, owed)
                where = label(position)
                stable_in[where] = stable_in.get(where, Side()).plus(held, owed)
            else:
                volatile = volatile.plus(held, owed)
    return Exposure(
        stable=stable,
        volatile=volatile,
        by_token=tuple(sorted(tokens.items(), key=lambda row: -abs(row[1].net))),
        stable_in=tuple(sorted(stable_in.items(), key=lambda row: -(row[1].held + row[1].owed))),
        unsplit=tuple(sorted(unsplit, key=lambda row: -row[1])),
    )


def _as_one_leg(position: Position) -> tuple[Leg, ...]:
    symbol = position.symbol.strip()
    if not symbol:
        return ()
    if position.category == "token" or is_stablecoin(symbol):
        return (Leg(symbol=symbol, role="supply", value_usd=position.value_usd),)
    return ()


@dataclass(frozen=True)
class Reading:
    at: str
    usd: float
    epoch_ms: float | None = None


@dataclass(frozen=True)
class Change:
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
        return (self.delta / self.first.usd * 100) if self.first.usd else 0.0


@dataclass(frozen=True)
class History:
    range: str
    readings: tuple[Reading, ...] = ()

    def window(self, period: str) -> "History":
        width = WINDOW_MS.get(period)
        if width is None or not self.readings:
            return self
        last = self.readings[-1].epoch_ms
        if last is None:
            return self
        opens = last - width
        inside = tuple(r for r in self.readings if (r.epoch_ms or 0) >= opens)
        return History(range=self.range, readings=inside) if len(inside) >= 2 else self

    def change(self, period: str) -> Change | None:
        inside = self.window(period).readings
        return Change(period=period, readings=inside) if len(inside) >= 2 else None


@dataclass(frozen=True)
class PortfolioRef:
    slug: str
    name: str | None = None


@dataclass(frozen=True)
class Me:
    user_id: str
    portfolios: tuple[PortfolioRef, ...] = ()


def total_of(positions: Iterable[Position]) -> float:
    return sum(position.value_usd for position in positions)
