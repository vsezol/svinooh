"""What a lending opportunity is, once the protocol it came from is forgotten.

One shape for two upstream things that are the same product to a depositor: a
Kamino vault (one token in, a curator spreads it across reserves) and a Kamino
Lend reserve (one token in, borrowers of that market pay for it). Anything a
second protocol adds later normalises into this or does not belong in /lend.

Money is `Decimal` throughout and never `float`. Kamino answers with decimal
strings of thirty-odd digits; binary floating point cannot hold them, and a
rate that is wrong in the fourth place is a rate somebody quotes at a user.
"""
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Literal

PoolKind = Literal["vault", "reserve"]

ZERO = Decimal(0)


def dec(value: object, default: Decimal = ZERO) -> Decimal:
    """A number from an upstream payload, or `default` if it is not one.

    Upstream sends numbers as strings, sometimes in scientific notation
    ("2.98e-14"), sometimes missing, occasionally null. None of those is worth
    failing a whole refresh over — a field we cannot read is a field we do not
    have.
    """
    if value is None:
        return default
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default
    return default if not parsed.is_finite() else parsed


@dataclass(frozen=True)
class Token:
    """The asset you deposit."""

    symbol: str
    mint: str
    #: Only where an upstream payload actually said so — see app/sources/kamino.py.
    #: Nothing served today needs it (upstream amounts arrive already scaled);
    #: it is here because building a deposit transaction will.
    decimals: int | None = None


@dataclass(frozen=True)
class Apy:
    """What the pool pays, split into where it comes from.

    Kamino's own UI has a toggle for "include KMNO rewards in APY", so the two
    halves are visibly different products: the base rate is what borrowers pay
    and keeps paying, incentives are a programme that ends. Returning one
    blended number would have the agent quote a figure the user cannot find on
    the screen in front of them.
    """

    base: Decimal
    rewards: Decimal = ZERO
    incentives: Decimal = ZERO

    @property
    def net(self) -> Decimal:
        """Everything the depositor earns, which is what a ranking sorts on."""
        return self.base + self.rewards + self.incentives


@dataclass(frozen=True)
class ApyWindows:
    """The same rate averaged over trailing periods, as upstream reports them.

    A vault's live APY swings with what its curator did this morning; "what did
    this actually pay" is the 30-day number. Both belong in an answer.
    """

    h24: Decimal | None = None
    d7: Decimal | None = None
    d30: Decimal | None = None
    d90: Decimal | None = None
    d365: Decimal | None = None


@dataclass(frozen=True)
class Liquidity:
    deposited: Decimal
    deposited_usd: Decimal
    #: Sitting uninvested, and so withdrawable immediately. Vaults only.
    available: Decimal | None = None
    available_usd: Decimal | None = None
    #: Borrowed over supplied. Reserves only — a reserve at 100% cannot be
    #: withdrawn from until somebody repays, which is a fact about the deposit
    #: and not a statistic.
    utilization: Decimal | None = None


@dataclass(frozen=True)
class Fees:
    performance_bps: int
    management_bps: int


@dataclass(frozen=True)
class Allocation:
    """Where a vault's money currently sits — the risk the depositor takes."""

    reserve: str
    market: str
    market_name: str
    token_symbol: str
    weight_pct: Decimal
    amount: Decimal | None = None


@dataclass(frozen=True)
class DepositTerms:
    """Everything a client needs to move from "I want this" to a signature.

    Nothing here is used by the read API. It is the reason the detail endpoint
    exists as its own resource: when transaction building arrives it must not
    need a second source of truth about which accounts a deposit touches.
    """

    program_id: str
    #: The account the deposit is made into: a vault, or a reserve.
    address: str
    min_amount: Decimal | None = None
    shares_mint: str | None = None
    shares_decimals: int | None = None
    token_program: str | None = None
    #: The lending market a reserve belongs to; None for a vault.
    lending_market: str | None = None


@dataclass(frozen=True)
class Pool:
    """One place to put one token and be paid for it."""

    id: str
    network: str
    protocol: str
    kind: PoolKind
    name: str
    token: Token
    apy: Apy
    tvl_usd: Decimal
    liquidity: Liquidity
    deposit: DepositTerms
    url: str
    apy_windows: ApyWindows | None = None
    fees: Fees | None = None
    holders: int | None = None
    #: What this reserve charges borrowers. Reserves only — it is where a
    #: reserve's yield comes from, so it explains the rate rather than decorating it.
    borrow_apy: Decimal | None = None
    allocations: tuple[Allocation, ...] = field(default_factory=tuple)


def pool_id(network: str, protocol: str, kind: PoolKind, address: str) -> str:
    """The identifier a client holds on to.

    Self-contained on purpose: network, protocol, kind and address, so a stored
    id can be resolved without remembering which list it came out of. Colons
    are legal in a path segment (RFC 3986 `pchar`), so this needs no escaping
    in `/v1/lend/pools/{id}`.
    """
    return f"{network}:{protocol}:{kind}:{address}"
