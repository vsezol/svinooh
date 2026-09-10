"""Service configuration, read once from the environment.

Every knob lives here and nowhere else, so the *source* of the values can
change without touching the code that reads them. Names follow the repo
convention: SCREAMING_SNAKE_CASE, prefixed with the service's role.
"""
import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # ── upstream ────────────────────────────────────────────────────────────
    kamino_api: str = os.getenv("EARN_KAMINO_API", "https://api.kamino.finance")
    http_timeout_s: float = _float("EARN_HTTP_TIMEOUT_S", 20.0)
    # A refresh asks Kamino for 41 markets' reserves at once. Unbounded that is
    # a small stampede against somebody else's API; eight at a time finishes in
    # a couple of seconds and stays a polite client.
    http_concurrency: int = _int("EARN_HTTP_CONCURRENCY", 8)

    # ── the snapshot ────────────────────────────────────────────────────────
    # How often the catalog is rebuilt. Yields move in hours, not seconds, and
    # every request is served from memory either way — this only decides how
    # far behind Kamino the answer may be.
    refresh_interval_s: int = _int("EARN_REFRESH_INTERVAL_S", 300)
    # When the newest successful snapshot is older than this, answers carry
    # meta.stale = true. They are still answers: a rate from ten minutes ago is
    # useful, a rate that silently pretends to be live is not.
    stale_after_s: int = _int("EARN_STALE_AFTER_S", 900)
    # How many past snapshots stay reachable. A cursor points into the snapshot
    # it was issued from (app/query.py), so keeping a couple alive is what lets
    # a client finish paging through a list that has since been rebuilt.
    snapshot_history: int = _int("EARN_SNAPSHOT_HISTORY", 3)

    # ── what counts as a pool worth listing ─────────────────────────────────
    # Kamino's API returns every vault that was ever created — 178 of them,
    # against the ~30 its own UI shows. The difference is test and staging
    # vaults and ones nobody ever funded. There is no "visible" flag in the
    # API, so the floor is ours and it is a guess.
    #
    # A hundred thousand dollars, not ten: a reserve with $11k in it was
    # showing 165% APY and therefore ranking first for "where can I earn USDC".
    # The rate was real — a nearly-empty reserve at full utilisation — and the
    # recommendation was still nonsense, because nobody can put money in at
    # that rate. A floor is the cheapest defence against a true number that
    # means nothing.
    min_tvl_usd: float = _float("EARN_MIN_TVL_USD", 100_000.0)
    # Names that mark a pool as not meant for anybody — matched case-insensitively
    # as substrings of the pool name.
    excluded_name_marks: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            mark.strip().lower()
            for mark in os.getenv("EARN_EXCLUDED_NAME_MARKS", "test,staging,mock,demo").split(",")
            if mark.strip()
        )
    )
    # Direct supply into a Kamino Lend reserve is the same shape of thing as a
    # vault — one token in, a rate out — and costs 41 more requests per refresh.
    include_reserves: bool = os.getenv("EARN_INCLUDE_RESERVES", "1") == "1"

    # ── serving ─────────────────────────────────────────────────────────────
    default_page_size: int = _int("EARN_DEFAULT_PAGE_SIZE", 20)
    max_page_size: int = _int("EARN_MAX_PAGE_SIZE", 100)
    # Origins allowed to call this from a browser, comma-separated. Empty means
    # none, which is right while the only caller is the agent service.
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            origin.strip()
            for origin in os.getenv("EARN_CORS_ORIGINS", "").split(",")
            if origin.strip()
        )
    )


settings = Settings()
