import logging
from dataclasses import dataclass

import httpx
from limits.aio.storage import Storage
from redis.asyncio import ConnectionPool, Redis
from svinooh_portfolio.source import PortfolioApiSource

from .adapters import memory
from .adapters.earn import EarnApiSource
from .adapters.panel import RemotePanel
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
from .ports import Agent, Allowance, ConversationStore, Panel, RateLimiter, Strategies
from .settings import Settings

logger = logging.getLogger("svinooh-ai")


@dataclass(frozen=True)
class Container:
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
    turns: Turns
    chats: Chats
    redis: ConnectionPool | None = None
    http: httpx.AsyncClient | None = None

    async def start(self) -> None:
        await self.panel.start()

    async def stop(self) -> None:
        await self.panel.stop()
        if self.http is not None:
            await self.http.aclose()
        if self.redis is not None:
            await self.redis.disconnect()

    async def store_state(self) -> str:
        if self.redis is None:
            return "in-process"
        try:
            await Redis(connection_pool=self.redis).ping()
        except Exception as error:  # noqa: BLE001 — the answer IS the state
            logger.warning("redis did not answer a ping (%r)", error)
            return "unreachable"
        return "shared"


def build(settings: Settings) -> Container:
    redis = _redis(settings.redis_url)
    if redis is None:
        store: ConversationStore = memory.MemoryConversationStore()
        counters: Storage = memory.rate_limit_storage()
        strategies: Strategies = memory.MemoryStrategies()
    else:
        from .adapters.redis import rate_limit
        from .adapters.redis.conversations import RedisConversationStore
        from .adapters.redis.strategies import RedisStrategies

        store = RedisConversationStore(redis)
        counters = rate_limit.storage(settings.redis_url, redis)
        strategies = RedisStrategies(redis)

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
        strategies,
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
    return httpx.AsyncClient(
        timeout=httpx.Timeout(settings.context_timeout_s, connect=settings.http_connect_timeout_s),
        limits=httpx.Limits(
            max_connections=settings.http_max_connections,
            max_keepalive_connections=settings.http_keepalive_connections,
        ),
    )


def _redis(url: str) -> ConnectionPool | None:
    if not url:
        logger.warning(
            "REDIS_URL not set — conversations and rate-limit counters are kept in this "
            "process only"
        )
        return None
    from .adapters.redis import client

    return client.pool(url)
