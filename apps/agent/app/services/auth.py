"""Who is asking — the token validated against the host, never decoded here.

The agent shares no JWT_SECRET (the one-identity rule in DESIGN.md): the only
authority on a token is the host API, so validation is one cached question —
GET /auth/me with the caller's token. What comes back names the caller for
rate limiting and telemetry.

Two failure modes, deliberately opposite:

- The host REJECTS the token (401/403) — that is an answer, not an outage:
  the caller gets 401 and the client knows to re-authenticate.
- The host CANNOT answer (down, timing out) — the caller is treated as
  anonymous rather than turned away. Safe by construction: this gate only
  names callers; enforcement stays with the host API, which checks the same
  token on every data read and every write regardless of what we decide here.
  A forged token passing this gate during an outage can still read and write
  nothing.

The cache keys by token digest, not the token: a memory dump of this map
should name nobody's credentials. TTL is short (~60 s) because a validation
is only a name — data calls always carry the live token to the host.
"""

import hashlib
import logging
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException

from ..adapters.portfolio import PortfolioApiSource
from ..config import settings

logger = logging.getLogger("svinooh-ai")
portfolio_source = PortfolioApiSource(settings.portfolio_api_url)


@dataclass(frozen=True)
class Caller:
    user_id: str


# token digest -> (expires at, caller)
_cache: dict[str, tuple[float, Caller]] = {}


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _evict() -> None:
    now = time.time()
    dead = [key for key, (expires, _) in _cache.items() if expires < now]
    for key in dead:
        del _cache[key]


async def authenticate(token: str | None) -> Caller | None:
    """Name the caller, or None for the anonymous.

    Raises 401 only when the host affirmatively rejects the token.
    """
    if not token:
        return None
    _evict()
    key = _digest(token)
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    try:
        me = await portfolio_source.me(token)
    except httpx.HTTPStatusError as error:
        if error.response.status_code in (401, 403):
            raise HTTPException(status_code=401, detail="unknown token") from error
        logger.warning("auth check errored (%s) — treating caller as anonymous", error)
        return None
    except Exception as error:  # noqa: BLE001 — an outage must not close the door
        logger.warning("auth check failed (%r) — treating caller as anonymous", error)
        return None

    caller = Caller(user_id=str(me.get("id") or ""))
    _cache[key] = (time.time() + settings.auth_cache_ttl_s, caller)
    return caller
