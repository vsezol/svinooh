from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

from .earn import LiquidityPosition, PairPool

SOL = "So11111111111111111111111111111111111111112"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

BELOW_PCT = Decimal("1")
ABOVE_PCT = Decimal("0")
MOVE_OVER_PCT = Decimal("0.25")

COMMAND = "/lpdown"
EVERYTHING = ("all", "everything", "всё", "все")


@dataclass(frozen=True, slots=True)
class Command:
    off: bool = False
    amount: Decimal | None = None
    everything: bool = False


def command(text: str) -> Command | None:
    words = text.strip().split()
    if not words or words[0].lower() != COMMAND:
        return None
    if len(words) == 1:
        return Command()
    said = words[1].lower()
    if said == "off":
        return Command(off=True)
    if said in EVERYTHING:
        return Command(everything=True)
    try:
        amount = Decimal(said.replace(",", "."))
    except InvalidOperation:
        return Command()
    return Command(amount=amount) if amount > 0 else Command()


def runs_on(pool: PairPool) -> bool:
    return pool.x_mint == SOL and pool.y_mint == USDC


Where = Literal["move", "below", "waiting"]


@dataclass(frozen=True, slots=True)
class Reading:
    where: Where
    over_pct: Decimal


def reading(position: LiquidityPosition) -> Reading:
    price = position.pool.price
    over = (price / position.upper_price - 1) * 100
    if price < position.lower_price:
        return Reading("below", over)
    if over > MOVE_OVER_PCT:
        return Reading("move", over)
    return Reading("waiting", over)
