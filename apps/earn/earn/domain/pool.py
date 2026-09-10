"""A pool: one place to put one token and be paid for it.

`Pool` is the aggregate. Everything hanging off it is a value object — none of
them has an identity of its own, and none is meaningful outside the pool it
describes. The whole thing is frozen: a pool as of a moment is a fact, and a
fact that can be edited in place is one nobody can reason about.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from earn.domain.values import Network, PoolId, PoolKind, Protocol, Rate, Usd


@dataclass(frozen=True, slots=True)
class Token:
    """The asset you deposit."""

    symbol: str
    mint: str
    #: Only where upstream actually said so. Nothing served today needs it —
    #: upstream amounts arrive already scaled — but building a deposit
    #: transaction will, and inventing a plausible 6 would be worse than null.
    decimals: int | None = None


@dataclass(frozen=True, slots=True)
class Apy:
    """What the pool pays, split by where it comes from.

    The split is not decoration. `base` is what borrowers pay and keeps paying;
    `rewards` is a protocol programme that ends on a date somebody chose. They
    are different promises, and a caller showing a single blended figure is
    making a promise the protocol did not make.
    """

    base: Rate
    rewards: Rate = Rate.ZERO
    incentives: Rate = Rate.ZERO

    @property
    def net(self) -> Rate:
        """Everything the depositor earns — what a ranking sorts on."""
        return self.base + self.rewards + self.incentives


@dataclass(frozen=True, slots=True)
class ApyWindows:
    """The same rate averaged over trailing periods, as upstream reports them.

    A vault's live rate swings with what its curator did this morning; "what did
    this actually pay" is the thirty-day number. Both belong in an answer.
    """

    h24: Rate | None = None
    d7: Rate | None = None
    d30: Rate | None = None
    d90: Rate | None = None
    d365: Rate | None = None


@dataclass(frozen=True, slots=True)
class Liquidity:
    deposited: Decimal
    deposited_usd: Usd
    #: Sitting uninvested, and so withdrawable immediately. Vaults.
    available: Decimal | None = None
    available_usd: Usd | None = None
    #: Borrowed over supplied. Reserves — a reserve at 100% cannot be withdrawn
    #: from until somebody repays, which is a property of the deposit and not a
    #: statistic about it.
    utilization: Rate | None = None


@dataclass(frozen=True, slots=True)
class Fees:
    performance_bps: int
    management_bps: int


@dataclass(frozen=True, slots=True)
class Allocation:
    """Where a vault's money currently sits — the risk the depositor takes."""

    reserve: str
    market: str
    market_name: str
    token_symbol: str
    weight_pct: Decimal


@dataclass(frozen=True, slots=True)
class DepositTerms:
    """Everything a client needs to get from "I want this" to a signature.

    Nothing here is used to answer a read. It is the reason the detail endpoint
    is its own resource: when transaction building arrives it must not need a
    second source of truth about which accounts a deposit touches.
    """

    program_id: str
    #: The account deposited into: a vault, or a reserve.
    address: str
    min_amount: Decimal | None = None
    shares_mint: str | None = None
    shares_decimals: int | None = None
    token_program: str | None = None
    #: The lending market a reserve belongs to; None for a vault.
    lending_market: str | None = None


@dataclass(frozen=True, slots=True)
class Pool:
    """The aggregate root, identified by `id` and by nothing else."""

    id: PoolId
    name: str
    token: Token
    apy: Apy
    tvl_usd: Usd
    liquidity: Liquidity
    deposit: DepositTerms
    url: str
    apy_windows: ApyWindows | None = None
    fees: Fees | None = None
    holders: int | None = None
    #: What this reserve charges borrowers — where a reserve's yield comes
    #: from, so it explains the rate rather than decorating it. Reserves only.
    borrow_apy: Rate | None = None
    allocations: tuple[Allocation, ...] = field(default_factory=tuple)

    @property
    def network(self) -> Network:
        return self.id.network

    @property
    def protocol(self) -> Protocol:
        return self.id.protocol

    @property
    def kind(self) -> PoolKind:
        return self.id.kind
