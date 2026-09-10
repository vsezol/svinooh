"""Where the ports meet their adapters: the composition root.

`build` is the only function in the service that names a vendor. Everything
above it talks to app/ports.py; everything it builds implements one of those
ports. Replacing Redis with a database, or the host with another API, is a
new adapter plus one line here — never a change in app/services or the graph.

Built once per process by create_app, never at import: a module that wires
the service when imported cannot be imported by a test, and a test wants to
hand the service a container of its own (tests/support.py builds one over
fakes in the same shape).
"""

import logging
from dataclasses import dataclass

from limits.aio.storage import Storage
from redis.asyncio import ConnectionPool

from .adapters import memory
from .adapters.panel import RemotePanel
from .adapters.portfolio import PortfolioApiSource
from .agent.graph import Agent
from .agent.intent import IntentClassifier
from .agent.llm import Models
from .agent.onboarding import ConfirmationClassifier
from .config import Config
from .ports import Allowance, ConversationStore, Panel, RateLimiter
from .services.auth import Authenticator
from .services.identity import Identity
from .services.limits import WindowAllowance, WindowRateLimiter
from .services.sessions import SessionStore
from .settings import Settings

logger = logging.getLogger("svinooh-ai")


@dataclass(frozen=True)
class Container:
    """Everything a request handler may ask for, built once and handed down."""

    settings: Settings
    panel: Panel
    config: Config
    portfolio: PortfolioApiSource
    identity: Identity
    store: ConversationStore
    sessions: SessionStore
    limiter: RateLimiter
    allowance: Allowance
    agent: Agent
    #: The one Redis pool, shared by the store and the counters; None without
    #: a REDIS_URL, when both live in this process.
    redis: ConnectionPool | None = None

    async def start(self) -> None:
        """What must run before the first request: the panel is heard once."""
        await self.panel.start()

    async def stop(self) -> None:
        """What must run after the last: the refresh stops, the pool lets go."""
        await self.panel.stop()
        if self.redis is not None:
            await self.redis.disconnect()


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

    panel = RemotePanel(settings.portfolio_api_url, settings.context_timeout_s)
    config = Config(settings, panel)
    portfolio = PortfolioApiSource(settings.portfolio_api_url, settings.context_timeout_s)
    models = Models(settings)
    return Container(
        settings=settings,
        panel=panel,
        config=config,
        portfolio=portfolio,
        identity=Identity(Authenticator(portfolio, settings.auth_cache_ttl_s)),
        store=store,
        sessions=SessionStore(store, settings.history_max_messages, settings.chat_max_turns),
        limiter=WindowRateLimiter(
            settings.rate_limit_requests, settings.rate_limit_window_s, counters
        ),
        allowance=WindowAllowance(settings.free_questions, settings.free_window_s, counters),
        agent=Agent(
            config,
            portfolio,
            models,
            IntentClassifier(models, config),
            ConfirmationClassifier(models, config),
        ),
        redis=redis,
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
