from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from .conversation import Turn
from .earn import LiquidityPosition, PairPool

USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
ASSETS = ("SOL", "cbBTC", "WBTC", "xBTC", "zBTC")

BELOW_PCT = Decimal("1")
ABOVE_PCT = Decimal("0")
MOVE_OVER_PCT = Decimal("0.25")
NEAR_PCT = Decimal("1")
NEAR_AT_LEAST_USD = Decimal("1000")

COMMAND = "/lpdown"
STRATEGY = "lpdown"
EVERYTHING = ("all", "everything", "всё", "все")


def is_command(text: str) -> bool:
    words = text.strip().split()
    return bool(words) and words[0].lower() == COMMAND


def started(question: str, history: Iterable[Turn]) -> bool:
    return is_command(question) or any(is_command(turn.q) for turn in history if turn.q)


def takes(pool: PairPool) -> bool:
    return pool.y_mint == USDC and pool.x.upper() in {asset.upper() for asset in ASSETS}


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


def rate_a_day(pool: PairPool) -> Decimal | None:
    """A day of fees on the liquidity near the price, where there is enough of it to mean much."""
    if pool.fee_active is None or pool.active_usd is None or pool.active_usd < NEAR_AT_LEAST_USD:
        return None
    return pool.fee_active
