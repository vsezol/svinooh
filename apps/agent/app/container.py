"""Where the ports meet their adapters: the composition root.

`build` is the only function in the service that names a vendor. Everything
above it talks to app/ports.py; everything it builds implements one of those
ports. Replacing Redis with a database, or the host with another API, is a
new adapter plus one line here — never a change in app/application or the graph.

Built once per process by create_app, never at import: a module that wires
the service when imported cannot be imported by a test, and a test wants to
hand the service a container of its own (tests/support.py builds one over
fakes in the same shape).
"""

import logging
from dataclasses import dataclass

import httpx
from limits.aio.storage import Storage
from redis.asyncio import ConnectionPool, Redis

from .adapters import memory
from .adapters.earn import EarnApiSource
from .adapters.panel import RemotePanel
from .adapters.portfolio import PortfolioApiSource
from .agent.graph import LangGraphAgent
from .agent.intent import IntentClassifier
from .agent.llm import Models
from .agent.onboarding import ConfirmationClassifier
from .application.auth import Authenticator
from .application.chats import Chats
from .application.identity import Identity
from .application.limits import WindowAllowance, WindowRateLimiter
from .application.sessions import SessionStore
from .application.turns import Turns
from .config import Config
from .ports import Agent, Allowance, ConversationStore, Panel, RateLimiter
from .settings import Settings

logger = logging.getLogger("svinooh-ai")


@dataclass(frozen=True)
class Container:
    """Everything a request handler may ask for, built once and handed down."""

    settings: Settings
    panel: Panel
    config: Config
    portfolio: PortfolioApiSource
    catalog: EarnApiSource
    identity: Identity
    store: ConversationStore
    sessions: SessionStore
    limiter: RateLimiter
    allowance: Allowance
    agent: Agent
    #: The use cases the HTTP surface is a thin skin over.
    turns: Turns
    chats: Chats
    #: The one Redis pool, shared by the store and the counters; None without
    #: a REDIS_URL, when both live in this process.
    redis: ConnectionPool | None = None
    #: The one HTTP client, and therefore the one connection pool, every call
    #: to the host goes through. None in a test that never reaches one.
    http: httpx.AsyncClient | None = None

    async def start(self) -> None:
        """What must run before the first request: the panel is heard once."""
        await self.panel.start()

    async def stop(self) -> None:
        """What must run after the last: the refresh stops, the pools let go."""
        await self.panel.stop()
        if self.http is not None:
            await self.http.aclose()
        if self.redis is not None:
            await self.redis.disconnect()

    async def store_state(self) -> str:
        """Where conversations are being kept, right now.

        "in-process" is the honest name for the fallback, and "unreachable"
        is the one worth waking up for: a Redis that is configured and not
        answering means conversations are being lost silently.
        """
        if self.redis is None:
            return "in-process"
        try:
            await Redis(connection_pool=self.redis).ping()
        except Exception as error:  # noqa: BLE001 — the answer IS the state
            logger.warning("redis did not answer a ping (%r)", error)
            return "unreachable"
        return "shared"


def build(settings: Settings) -> Container:
    """The production wiring: Redis when there is a REDIS_URL, in-process when not."""
    redis = _redis(settings.redis_url)
    if redis is None:
        store: ConversationStore = memory.MemoryConversationStore()
        counters: Storage = memory.rate_limit_storage()
    else:
        from .adapters.redis import rate_limit
        from .adapters.redis.conversations import RedisConversationStore

        store = RedisConversationStore(redis)
        counters = rate_limit.storage(settings.redis_url, redis)

    http = _http(settings)
    panel = RemotePanel(settings.portfolio_api_url, http)
    config = Config(settings, panel)
    portfolio = PortfolioApiSource(settings.portfolio_api_url, http)
    catalog = EarnApiSource(settings.earn_api_url, http)
    models = Models(settings)
    identity = Identity(
        Authenticator(portfolio, settings.auth_cache_ttl_s, settings.auth_cache_max)
    )
    sessions = SessionStore(store, settings.history_max_messages, settings.chat_max_turns)
    limiter = WindowRateLimiter(
        settings.rate_limit_requests, settings.rate_limit_window_s, counters
    )
    allowance = WindowAllowance(settings.free_questions, settings.free_window_s, counters)
    agent: Agent = LangGraphAgent(
        config,
        portfolio,
        catalog,
        models,
        IntentClassifier(models, config),
        ConfirmationClassifier(models, config),
    )
    return Container(
        settings=settings,
        panel=panel,
        config=config,
        portfolio=portfolio,
        catalog=catalog,
        identity=identity,
        store=store,
        sessions=sessions,
        limiter=limiter,
        allowance=allowance,
        agent=agent,
        turns=Turns(
            sessions,
            identity,
            limiter,
            allowance,
            agent,
            settings.turn_timeout_s,
            settings.message_max_chars,
        ),
        chats=Chats(sessions, identity, settings.chat_list_limit),
        redis=redis,
        http=http,
    )


def _http(settings: Settings) -> httpx.AsyncClient:
    """The one client every call to the host shares.

    Connecting is not reading: a host that is down should be found out in
    seconds, while a slow answer gets the whole context budget. The pool caps
    are what keeps a burst of turns from opening a socket each.
    """
    return httpx.AsyncClient(
        timeout=httpx.Timeout(settings.context_timeout_s, connect=settings.http_connect_timeout_s),
        limits=httpx.Limits(
            max_connections=settings.http_max_connections,
            max_keepalive_connections=settings.http_keepalive_connections,
        ),
    )


def _redis(url: str) -> ConnectionPool | None:
    if not url:
        # A warning, not info: the store is the durable one, and without a URL
        # it is one process's memory — conversations die on restart, a second
        # replica has never heard of them, and the cost lock counts per
        # replica. Everything still answers, which is what makes it worth
        # saying loudly.
        logger.warning(
            "REDIS_URL not set — conversations and rate-limit counters are kept in this "
            "process only"
        )
        return None
    from .adapters.redis import client

    return client.pool(url)
