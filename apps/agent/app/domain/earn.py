from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

RiskBand = Literal["low", "medium", "high"]

THIN_TVL_USD = Decimal("5000000")
MOSTLY_PROGRAMMES = Decimal("0.5")


@dataclass(frozen=True, slots=True)
class DepositTerms:
    program_id: str
    address: str
    token_mint: str
    token_decimals: int | None = None
    min_amount: Decimal | None = None
    shares_mint: str | None = None
    shares_decimals: int | None = None
    token_program: str | None = None
    lending_market: str | None = None


@dataclass(frozen=True, slots=True)
class YieldPool:
    id: str
    name: str
    protocol: str
    kind: str
    network: str
    token: str
    apy_net: Decimal
    apy_base: Decimal
    apy_rewards: Decimal
    apy_incentives: Decimal
    tvl_usd: Decimal
    url: str
    terms: DepositTerms | None = None

    @property
    def programme_share(self) -> Decimal:
        if self.apy_net <= 0:
            return Decimal(0)
        return (self.apy_rewards + self.apy_incentives) / self.apy_net

    @property
    def is_thin(self) -> bool:
        return self.tvl_usd < THIN_TVL_USD

    @property
    def is_single_market(self) -> bool:
        return self.kind == "reserve"

    @property
    def pays_mostly_programmes(self) -> bool:
        return self.programme_share >= MOSTLY_PROGRAMMES

    @property
    def risk(self) -> RiskBand:
        if self.is_thin:
            return "high"
        if self.is_single_market or self.pays_mostly_programmes:
            return "medium"
        return "low"

    @property
    def risk_reasons(self) -> tuple[str, ...]:
        reasons = []
        if self.is_thin:
            reasons.append("thin: under $5M deposited")
        if self.is_single_market:
            reasons.append("one market's reserve rather than a curated spread")
        if self.pays_mostly_programmes:
            reasons.append("most of the rate is a reward programme, which ends")
        return tuple(reasons)


Action = Literal["deposit", "withdraw", "move"]


@dataclass(frozen=True, slots=True)
class Coin:
    """A coin by its mint, and what to call it."""

    symbol: str
    mint: str
    decimals: int


@dataclass(frozen=True, slots=True)
class Deposit:
    """What a card asks the wallet to sign.

    `pool` is the pool the card is about: where the money goes in a deposit
    and a move, where it comes out of in a withdrawal. A move also says where
    it leaves, `source`. `pay_with` is the coin a deposit spends when that is
    not the pool's own token, and `receive_as` the coin a withdrawal ends as —
    each swapped on the way. `amount` is counted in what is spent.
    `everything` takes out all there is, whatever the shares are worth by the
    time it is signed; `amount` is then the figure it was worth when it was
    read, for showing.
    """

    pool: YieldPool
    amount: Decimal
    terms: DepositTerms
    action: Action = "deposit"
    source: YieldPool | None = None
    everything: bool = False
    pay_with: Coin | None = None
    receive_as: Coin | None = None

    @property
    def below_minimum(self) -> bool:
        if self.action == "withdraw" or self.pay_with is not None:
            return False
        minimum = self.terms.min_amount
        return minimum is not None and self.amount < minimum


@dataclass(frozen=True, slots=True)
class PairPool:
    """A pool pairing two tokens, priced in bins (Meteora DLMM).

    `price` is how much `y` one `x` costs. `fee_apr` is a year of the last
    day's fees — paid only to liquidity inside the price's range, and only as
    steady as the trading behind it. With a range asked about, `range_bins`
    is how many of the pool's bins it spans and `why_not` why one position
    will not hold it.
    """

    id: str
    name: str
    x: str
    y: str
    x_mint: str
    y_mint: str
    bin_step: int
    fee_apr: Decimal
    tvl_usd: Decimal
    price: Decimal
    url: str
    range_bins: int | None = None
    why_not: str | None = None
    active_usd: Decimal | None = None
    fee_active: Decimal | None = None

    @property
    def risk(self) -> RiskBand:
        return "high" if self.tvl_usd < THIN_TVL_USD else "medium"

    def token(self, named: str) -> tuple[str, str] | None:
        """The pool's token a ticker or a mint names, as (symbol, mint)."""
        asked = named.strip()
        for symbol, mint in ((self.x, self.x_mint), (self.y, self.y_mint)):
            if asked == mint or asked.upper() == symbol.upper():
                return symbol, mint
        return None


@dataclass(frozen=True, slots=True)
class LiquidityPosition:
    """Liquidity somebody has placed in a pair pool: its range, and what it holds now."""

    address: str
    pool: PairPool
    lower_price: Decimal
    upper_price: Decimal
    in_range: bool
    amount_x: Decimal
    amount_y: Decimal
    value_usd: Decimal
    fees_usd: Decimal


PlacementAction = Literal["provide", "close", "rebalance"]


@dataclass(frozen=True, slots=True)
class Placement:
    """Liquidity a card asks the wallet to sign.

    `provide` places `amount` of `pay_with` — one of the pool's two tokens,
    the rest swapped into the other so both sides fill — from `below_pct`
    under the price to `above_pct` over it. `close` empties `position`;
    `rebalance` closes it and places what it held again around the price,
    across the range given or, with none, as wide as it was.
    """

    action: PlacementAction
    pool: PairPool
    amount: Decimal | None = None
    pay_with: Coin | None = None
    below_pct: Decimal | None = None
    above_pct: Decimal | None = None
    position: LiquidityPosition | None = None
    source: YieldPool | None = None
    everything: bool = False
    strategy: str | None = None


@dataclass(frozen=True, slots=True)
class Held:
    """Money somebody has in a pool, read from the chain, in the pool's token.

    `shares` is how many of the pool's shares that is: the one number both the
    chain and a portfolio scanner report for the same position, so it is what
    tells the two apart from two positions.
    """

    pool: YieldPool
    amount: Decimal
    shares: Decimal | None = None


SwapAction = Literal["swap"]


@dataclass(frozen=True, slots=True)
class Swap:
    """One coin in the wallet traded for another, both staying in the wallet.

    `amount` is counted in `pay_with`. `everything` swaps all there is of it
    by the time it is signed; `amount` is then the figure it was when it was
    read, for showing.
    """

    pay_with: Coin
    receive_as: Coin
    amount: Decimal
    everything: bool = False
    action: SwapAction = "swap"


Card = Deposit | Placement | Swap
"""Anything a card asks the wallet to sign."""


SettledStatus = Literal["landed", "failed", "sent", "refused"]


@dataclass(frozen=True, slots=True)
class Settled:
    """What became of something signed from a card.

    `token` is what `amount` is counted in — what left — and `into` what it
    became, when it was swapped on the way. `halfway` is a thing in several
    transactions whose first landed and whose rest did not; the money then
    waits in the wallet as `holding`.
    """

    amount: str
    token: str
    pool: str
    status: SettledStatus
    signature: str | None = None
    error: str | None = None
    action: "Action | PlacementAction | SwapAction" = "deposit"
    from_pool: str | None = None
    into: str | None = None
    halfway: bool = False
    holding: str | None = None
    strategy: str | None = None
    position: str | None = None


@dataclass(frozen=True, slots=True)
class CatalogSnapshot:
    pools: tuple[YieldPool, ...]
    as_of: datetime | None = None
    stale: bool = False
