from svinooh_portfolio import wire
from svinooh_portfolio.portfolio import History, Portfolio, Position


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


def wallet(
    address: str,
    positions: list[dict],
    *,
    chain: str = "EVM",
    status: str = "ok",
    stale: bool = False,
) -> dict:
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


USDC_SOL = position(
    "USDC",
    12.0,
    network="sol",
    platform="wallet",
    category="token",
    amount=12.0014,
    price=1.0,
)

EVM_ADDRESS = "0x7bfee91193d9df2ac0bfe90191d40f23c773c060"
SOL_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"

AAVE = position(
    "AAVE-V3",
    12_600.00,
    name="Aave V3 (Lending)",
    platform="aave3",
    category="defi",
    health=2.14,
    borrow_apy=0.032,
    tokens=[
        {
            "role": "supply",
            "symbol": "WETH",
            "amount": 5.0,
            "priceUsd": 2_500.0,
            "valueUsd": 12_500.0,
        },
        {
            "role": "borrow",
            "symbol": "USDC",
            "amount": 5_200.0,
            "priceUsd": 1.0,
            "valueUsd": 5_200.0,
        },
    ],
)

UNISWAP = position(
    "UNI-V3",
    3_600.00,
    name="Uniswap V3 (Liquidity Pool)",
    platform="uniswap3",
    category="defi",
    apy=0.478,
    range_="in",
    band={
        "pair": "cbBTC/USDC",
        "feePct": 0.05,
        "lower": 90_000.0,
        "upper": 110_000.0,
        "current": 96_200.0,
        "chainLabel": "Ethereum",
    },
    tokens=[
        {
            "role": "supply",
            "symbol": "cbBTC",
            "amount": 0.02,
            "priceUsd": 96_200.0,
            "valueUsd": 1_924.0,
        },
        {
            "role": "supply",
            "symbol": "USDC",
            "amount": 1_676.0,
            "priceUsd": 1.0,
            "valueUsd": 1_676.0,
        },
    ],
)

KAMINO = position(
    "Kamino",
    11_746.29,
    name="Lending",
    network="sol",
    platform="kamino",
    category="defi",
    health=2.98,
    borrow_apy=0.0527,
    tokens=[
        {
            "role": "supply",
            "symbol": "cbBTC",
            "amount": 0.1329,
            "priceUsd": 80_836.0,
            "valueUsd": 10_743.16,
            "apy": 0.0000319,
        },
        {
            "role": "supply",
            "symbol": "SOL",
            "amount": 40.57,
            "priceUsd": 110.68,
            "valueUsd": 4_490.13,
            "apy": 0.0452,
        },
        {
            "role": "borrow",
            "symbol": "USDT",
            "amount": 4_205.29,
            "priceUsd": 0.999,
            "valueUsd": -4_202.27,
            "apy": 0.0527,
        },
    ],
)

AAVE_NAMELESS = position(
    "AAVE-V3",
    11_821.80,
    name="Aave V3 (Lending)",
    platform="aave3",
    category="defi",
    tokens=[
        {
            "role": "supply",
            "symbol": "cbBTC",
            "amount": 0.1188,
            "priceUsd": 91_066.0,
            "valueUsd": 10_818.65,
            "apy": 0.0001,
        },
        {
            "role": "supply",
            "symbol": "",
            "amount": None,
            "priceUsd": None,
            "valueUsd": 1_003.15,
            "apy": 0.0,
        },
    ],
)

NAMELESS = position("", 1_003.15, network="eth", platform="aave3", category="defi")


FLUID = position(
    "Fluid",
    10_187.88,
    name="Yield",
    network="arb",
    platform="fluid",
    category="defi",
    apy=0.042,
)

ETH = position("ETH", 16_683.65, network="eth", amount=6.7122, price=2_485.59)

DUST = position("MICRO", 15_946.57, network="bsc", amount=252_414_000_000.0, price=6.3e-08)

BASE_TOKEN = position("TRUE", 14_981.09, network="base", amount=1_066_680.0, price=0.014)
SOL_TOKEN = position("SOL", 4_200.00, network="sol", amount=25.0, price=168.0)


def small(index: int) -> dict:
    return position(f"SMALL{index}", 100.0 - index, network="eth", amount=index + 1.0, price=1.0)


def rich_portfolio(tail: int = 0) -> dict:
    positions = [ETH, UNISWAP, AAVE, DUST, BASE_TOKEN] + [small(i) for i in range(tail)]
    return portfolio([wallet(EVM_ADDRESS, positions)], name="Main portfolio")


def two_wallet_portfolio() -> dict:
    return portfolio(
        [wallet(EVM_ADDRESS, [ETH, UNISWAP]), wallet(SOL_ADDRESS, [SOL_TOKEN], chain="SOL")],
        name="Split",
    )


def history(points: list[tuple[str, float]], range_: str = "7d") -> dict:
    return {
        "range": range_,
        "points": [
            {"t": stamp, "usd": total, "claimableUsd": None, "debtUsd": None}
            for stamp, total in points
        ],
    }


def as_portfolio(data: dict | None = None, **kwargs) -> Portfolio:
    return wire.portfolio(rich_portfolio(**kwargs) if data is None else data)


def as_history(points: list[tuple[str, float]], range_: str = "7d") -> History:
    return wire.history(history(points, range_))


def as_position(data: dict) -> Position:
    return wire.position(data)
