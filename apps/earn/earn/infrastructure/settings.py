"""Configuration, parsed and validated like any other untrusted input.

The environment is input from outside the process, so it goes through the same
machinery as an HTTP body: declared types, real validation, one place to look.
A typo in `EARN_REFRESH_INTERVAL_S` fails at startup with a message, instead of
silently falling back to a default nobody chose.

Values are read once and injected. Nothing in this service reaches for a global
`settings` — the composition root in `earn.api.app` is the only place that
knows where configuration comes from.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EARN_", env_file=".env", extra="ignore")

    # ── upstream ────────────────────────────────────────────────────────────
    kamino_api: str = "https://api.kamino.finance"
    http_timeout_s: float = Field(default=20.0, gt=0)
    #: A refresh asks Kamino about 41 markets at once. Unbounded that is a
    #: small stampede against an API nobody is paying for.
    http_concurrency: int = Field(default=8, ge=1, le=64)

    # ── the catalog ─────────────────────────────────────────────────────────
    #: Yields move in hours, not seconds, and every request is served from
    #: memory either way — this only decides how far behind upstream an answer
    #: may be.
    refresh_interval_s: int = Field(default=300, ge=10)
    #: Past this, answers carry `meta.stale`. They are still answers: a rate
    #: from ten minutes ago is useful, a rate silently pretending to be live is
    #: not.
    stale_after_s: int = Field(default=900, ge=10)
    #: How many past catalogs stay reachable, so a cursor issued against one
    #: still resolves after a rebuild.
    catalog_history: int = Field(default=3, ge=1, le=20)
    #: How long startup waits for the first catalog before serving anyway.
    #: Long enough that a healthy service is ready on the first healthcheck
    #: probe; short enough that an unreachable upstream cannot stop a deploy.
    startup_grace_s: float = Field(default=45.0, ge=0)

    # ── what is worth listing ───────────────────────────────────────────────
    min_tvl_usd: Decimal = Field(default=Decimal(100_000), ge=0)
    include_reserves: bool = True

    # ── serving ─────────────────────────────────────────────────────────────
    default_page_size: int = Field(default=20, ge=1)
    max_page_size: int = Field(default=100, ge=1)

    # Comma-separated lists are kept as strings and split by the properties
    # below. Declaring them as `tuple[str, ...]` would make pydantic expect
    # JSON in the variable, which is not what anybody types into a dashboard.
    excluded_name_marks_csv: str = Field(
        default="test,staging,mock,demo", alias="EARN_EXCLUDED_NAME_MARKS"
    )
    cors_origins_csv: str = Field(default="", alias="EARN_CORS_ORIGINS")

    @property
    def excluded_name_marks(self) -> tuple[str, ...]:
        return _csv(self.excluded_name_marks_csv, lower=True)

    @property
    def cors_origins(self) -> tuple[str, ...]:
        """Empty means no browser may call this directly — right while the only
        caller is the agent service over the private network."""
        return _csv(self.cors_origins_csv)

    @property
    def refresh_interval(self) -> timedelta:
        return timedelta(seconds=self.refresh_interval_s)

    @property
    def stale_after(self) -> timedelta:
        return timedelta(seconds=self.stale_after_s)


def _csv(raw: str, *, lower: bool = False) -> tuple[str, ...]:
    parts = (part.strip() for part in raw.split(","))
    return tuple(part.lower() if lower else part for part in parts if part)
