"""Portfolios shaped like our own API, built by hand.

Every test reads from here rather than from a recorded response, because a
recording is a snapshot of somebody else's chain: token prices move, a wallet
gains a position, a protocol renames itself, and a test that fails for those
reasons teaches nothing. These fixtures change only when OUR DTO changes —
which is exactly when the tools that read it should be re-examined.

The shapes mirror PortfolioDto / WalletDto / PositionDto in libs/shared: the
fields the agent reads are all present, including the ones a plain token
holding leaves null.
"""


def position(
    symbol: str,
    value: float,
    *,
    name: str | None = None,
    network: str = "eth",
    platform: str = "wallet",
    category: str = "token",
    amount: float | None = None,
    price: float | None = None,
    apy: float | None = None,
    health: float | None = None,
    borrow_apy: float | None = None,
    range_: str | None = None,
    band: dict | None = None,
    tokens: list[dict] | None = None,
) -> dict:
    """One position with every field the API sends, defaulted like a token."""
    return {
        "id": f"pos-{symbol}-{value}",
        "symbol": symbol,
        "name": name,
        "note": None,
        "network": network,
        "amount": amount,
        "priceUsd": price,
        "valueUsd": value,
        "platform": platform,
        "category": category,
        "apy": apy,
        "healthRate": health,
        "borrowApy": borrow_apy,
        "range": range_,
        "band": band,
        "tokens": tokens,
    }


def wallet(address: str, positions: list[dict], *, chain: str = "EVM", status: str = "ok",
           stale: bool = False) -> dict:
    return {
        "id": f"w-{address[-4:]}",
        "address": address,
        "chain": chain,
        "label": None,
        "status": status,
        "stale": stale,
        "totalUsd": round(sum(p["valueUsd"] for p in positions), 2),
        "positions": positions,
    }


def portfolio(wallets: list[dict], *, slug: str = "test-pf", name: str | None = None) -> dict:
    return {
        "slug": slug,
        "name": name,
        "totalUsd": round(sum(w["totalUsd"] for w in wallets), 2),
        "wallets": wallets,
    }


EVM_ADDRESS = "0x7bfee91193d9df2ac0bfe90191d40f23c773c060"
SOL_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"

#: A lending position: supplied and borrowed legs, a health factor and a rate.
AAVE = position(
    "AAVE-V3",
    12_600.00,
    name="Aave V3 (Lending)",
    platform="aave3",
    category="defi",
    health=2.14,
    borrow_apy=0.032,
    tokens=[
        {"role": "supply", "symbol": "WETH", "amount": 5.0, "priceUsd": 2_500.0, "valueUsd": 12_500.0},
        {"role": "borrow", "symbol": "USDC", "amount": 5_200.0, "priceUsd": 1.0, "valueUsd": 5_200.0},
    ],
)

#: A concentrated liquidity position: a pair, a fee tier, a range verdict.
UNISWAP = position(
    "UNI-V3",
    3_600.00,
    name="Uniswap V3 (Liquidity Pool)",
    platform="uniswap3",
    category="defi",
    apy=0.478,
    range_="in",
    band={"pair": "cbBTC/USDC", "feePct": 0.05, "lower": 90_000.0, "upper": 110_000.0,
          "current": 96_200.0, "chainLabel": "Ethereum"},
    tokens=[
        {"role": "supply", "symbol": "cbBTC", "amount": 0.02, "priceUsd": 96_200.0, "valueUsd": 1_924.0},
        {"role": "supply", "symbol": "USDC", "amount": 1_676.0, "priceUsd": 1.0, "valueUsd": 1_676.0},
    ],
)

#: A plain holding, priced normally.
ETH = position("ETH", 16_683.65, network="eth", amount=6.7122, price=2_485.59)

#: A meme token priced below a millionth — the case that printed as "$0".
DUST = position("MICRO", 15_946.57, network="bsc", amount=252_414_000_000.0, price=6.3e-08)

#: Positions on other networks, so the by-network line has something to say.
BASE_TOKEN = position("TRUE", 14_981.09, network="base", amount=1_066_680.0, price=0.014)
SOL_TOKEN = position("SOL", 4_200.00, network="sol", amount=25.0, price=168.0)


def small(index: int) -> dict:
    """One of the many positions the context block leaves out."""
    return position(f"SMALL{index}", 100.0 - index, network="eth", amount=index + 1.0, price=1.0)


def rich_portfolio(tail: int = 0) -> dict:
    """A portfolio with one of everything, plus an optional tail of dust."""
    positions = [ETH, UNISWAP, AAVE, DUST, BASE_TOKEN] + [small(i) for i in range(tail)]
    return portfolio([wallet(EVM_ADDRESS, positions)], name="Main portfolio")


def two_wallet_portfolio() -> dict:
    return portfolio(
        [wallet(EVM_ADDRESS, [ETH, UNISWAP]), wallet(SOL_ADDRESS, [SOL_TOKEN], chain="SOL")],
        name="Split",
    )


def history(points: list[tuple[str, float]], range_: str = "7d") -> dict:
    """A HistoryDto: ISO timestamps and totals, oldest first.

    The names are the API's own — claimableUsd and debtUsd, not claimable and
    debt. The contract test caught that the moment it first ran, which is the
    entire reason it exists.
    """
    return {
        "range": range_,
        "points": [
            {"t": stamp, "usd": total, "claimableUsd": None, "debtUsd": None}
            for stamp, total in points
        ],
    }
