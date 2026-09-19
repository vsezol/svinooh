from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from ..domain.portfolio import (
    Band,
    History,
    Leg,
    Me,
    Portfolio,
    PortfolioRef,
    Position,
    Reading,
    Wallet,
)


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    @field_validator(
        "tokens", "positions", "wallets", "points", "portfolios", mode="before", check_fields=False
    )
    @classmethod
    def _none_is_empty(cls, value: object) -> object:
        return [] if value is None else value


class LegWire(Wire):
    symbol: str = ""
    role: str = "supply"
    value_usd: float = 0.0
    amount: float | None = None
    price_usd: float | None = None
    apy: float | None = None


class BandWire(Wire):
    pair: str | None = None
    fee_pct: float | None = None


class PositionWire(Wire):
    symbol: str = ""
    value_usd: float = 0.0
    name: str | None = None
    network: str | None = None
    platform: str | None = None
    category: str | None = None
    amount: float | None = None
    price_usd: float | None = None
    apy: float | None = None
    borrow_apy: float | None = None
    health_rate: float | None = None
    range: str | None = Field(default=None, alias="range")
    band: BandWire | None = None
    tokens: list[LegWire] = Field(default_factory=list)


class WalletWire(Wire):
    address: str = "?"
    chain: str = "?"
    status: str = "?"
    total_usd: float | None = None
    stale: bool = False
    positions: list[PositionWire] = Field(default_factory=list)


class PortfolioWire(Wire):
    slug: str = ""
    name: str | None = None
    total_usd: float = 0.0
    wallets: list[WalletWire] = Field(default_factory=list)


class ReadingWire(Wire):
    t: str | float | None = None
    usd: float | None = None


class HistoryWire(Wire):
    range: str = Field(default="", alias="range")
    points: list[ReadingWire] = Field(default_factory=list)


class PortfolioRefWire(Wire):
    slug: str = ""
    name: str | None = None


class MeWire(Wire):
    id: str = ""
    portfolios: list[PortfolioRefWire] = Field(default_factory=list)


class SlugWire(Wire):
    slug: str = ""


def epoch_ms(stamp: str | float | None) -> float | None:
    if isinstance(stamp, (int, float)):
        return float(stamp)
    if isinstance(stamp, str):
        try:
            return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            return None
    return None


def _leg(wire: LegWire) -> Leg:
    return Leg(
        symbol=wire.symbol,
        role=wire.role,
        value_usd=wire.value_usd,
        amount=wire.amount,
        price_usd=wire.price_usd,
        apy=wire.apy,
    )


def _position(wire: PositionWire) -> Position:
    band = (
        Band(pair=wire.band.pair, fee_pct=wire.band.fee_pct)
        if wire.band and wire.band.pair
        else None
    )
    return Position(
        symbol=wire.symbol,
        value_usd=wire.value_usd,
        name=wire.name,
        network=wire.network,
        platform=wire.platform,
        category=wire.category,
        amount=wire.amount,
        price_usd=wire.price_usd,
        apy=wire.apy,
        borrow_apy=wire.borrow_apy,
        health_rate=wire.health_rate,
        range=wire.range,
        band=band,
        legs=tuple(_leg(leg) for leg in wire.tokens),
    )


def _wallet(wire: WalletWire) -> Wallet:
    return Wallet(
        address=wire.address,
        chain=wire.chain,
        status=wire.status,
        total_usd=wire.total_usd,
        stale=wire.stale,
        positions=tuple(_position(p) for p in wire.positions),
    )


def portfolio(payload: object) -> Portfolio:
    wire = PortfolioWire.model_validate(payload)
    return Portfolio(
        slug=wire.slug,
        total_usd=wire.total_usd,
        name=wire.name,
        wallets=tuple(_wallet(w) for w in wire.wallets),
    )


def position(payload: object) -> Position:
    return _position(PositionWire.model_validate(payload))


def history(payload: object) -> History:
    wire = HistoryWire.model_validate(payload)
    return History(
        range=wire.range,
        readings=tuple(
            Reading(at=str(point.t), usd=point.usd, epoch_ms=epoch_ms(point.t))
            for point in wire.points
            if point.usd is not None
        ),
    )


def me(payload: object) -> Me:
    wire = MeWire.model_validate(payload)
    return Me(
        user_id=wire.id,
        portfolios=tuple(PortfolioRef(slug=ref.slug, name=ref.name) for ref in wire.portfolios),
    )


def slug(payload: object) -> str:
    return SlugWire.model_validate(payload).slug
