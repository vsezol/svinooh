"""Where the ports meet their adapters — the one module that names a vendor.

Everything above this file talks to app/ports.py. Everything below implements
one of those ports. This is the only place that decides which implementation is
in use, which is what makes "replace Redis with a database, or with an HTTP
service" a new module in app/adapters plus one line here.

Redis when there is a REDIS_URL, in-process when there is not — the same shape
apps/api/src/cache/cache.service.ts uses, so local development needs no Redis
and the fallback is honest about being one process's memory.

The objects are built once, at import, and the routes hold references to them.
A wiring framework would be the alternative and would buy nothing here: there
is one composition, it is picked from one setting, and a test that wants a
different one re-initialises these two objects in place.
"""
import logging

from .adapters import memory
from .config import settings
from .ports import Allowance, ConversationStore, RateLimiter
from .services.limits import WindowAllowance, WindowRateLimiter
from .services.sessions import SessionStore

logger = logging.getLogger("svinooh-ai")


def conversation_store(redis_url: str) -> ConversationStore:
    if not redis_url:
        logger.info("REDIS_URL not set — conversations are kept in this process")
        return memory.MemoryConversationStore()
    # Imported here rather than at module scope so a service with no Redis
    # never imports the driver at all.
    from .adapters.redis.conversations import RedisConversationStore

    return RedisConversationStore(redis_url)


def rate_limiter(redis_url: str, max_requests: int, window_s: int) -> RateLimiter:
    if not redis_url:
        logger.info("REDIS_URL not set — rate limiting is per-process")
        return WindowRateLimiter(max_requests, window_s, memory.rate_limit_storage())
    from .adapters.redis import rate_limit

    return WindowRateLimiter(max_requests, window_s, rate_limit.storage(redis_url))


#: The conversations, and the model context derived from them.
sessions = SessionStore(
    conversation_store(settings.redis_url),
    settings.history_max_messages,
    settings.chat_max_turns,
)

#: The cost lock.
limiter = rate_limiter(
    settings.redis_url, settings.rate_limit_requests, settings.rate_limit_window_s
)


def free_allowance(redis_url: str, max_questions: int, window_s: int) -> Allowance:
    if not redis_url:
        logger.info("REDIS_URL not set — the free allowance is counted per-process")
        return WindowAllowance(max_questions, window_s, memory.rate_limit_storage())
    from .adapters.redis import rate_limit

    return WindowAllowance(max_questions, window_s, rate_limit.storage(redis_url))


#: The product limit — what a visitor gets before the answer is the sign-in card.
allowance = free_allowance(
    settings.redis_url, settings.free_questions, settings.free_window_s
)
