UNNAMED_POSITION = "unnamed position"

UNNAMED_TOKEN = "unnamed token"

NO_NAME = ("", "?")


def named(symbol: str | None, unnamed: str) -> str:
    clean = (symbol or "").strip()
    return unnamed if clean in NO_NAME else clean


def usd(value: float | None) -> str:
    return f"${value:,.2f}" if value is not None else "n/a"


def short_address(address: str) -> str:
    return address if len(address) <= 14 else f"{address[:8]}…{address[-4:]}"


def amount_at(amount: float | None, price: float | None) -> str | None:
    if amount is None or amount <= 0:
        return None
    figure = f"{amount:,.4f}".rstrip("0").rstrip(".") if amount < 1000 else f"{amount:,.0f}"
    if price is None or price <= 0:
        return figure
    if price >= 0.01:
        shown = f"{price:,.2f}"
    elif price >= 1e-6:
        shown = f"{price:.8f}".rstrip("0").rstrip(".")
    else:
        shown = f"{price:.2e}"
    return f"{figure} @ ${shown}"


def rate(fraction: float) -> str:
    percent = fraction * 100
    if 0 < percent < 0.01:
        return "<0.01%"
    return f"{percent:.2f}%"
