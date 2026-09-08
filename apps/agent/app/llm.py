"""The model behind the answers, behind a provider-neutral seam.

No provider SDK is imported here: init_chat_model resolves the configured
"<provider>:<model>" string at call time, so langchain-anthropic serves today's
default and switching to another provider (Gemini, OpenAI, ...) is a new
AGENT_MODEL value plus that provider's langchain package in requirements.txt —
never an import change in this codebase.

Built lazily, once. The service boots and answers /health before any API key is
set — the key is only needed on the first /chat — so a deploy with the key
still pending degrades to "chat errors" instead of a crash loop. One client
instance is then reused for every request: what is per-request is the API
*call*, not the client.
"""
import logging
from functools import cache

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage

from .config import settings

logger = logging.getLogger("svinooh-ai")


# Endpoints that turned out to refuse a thinking budget. Some mandate
# reasoning and reject a request that lowers or disables it — a 400 that would
# otherwise kill every classification for as long as the setting stands.
_refuses_budget: set[str] = set()


def _reasoning(effort: str, model: str) -> dict:
    """Thinking budget, expressed the way an OpenAI-compatible aggregator wants.

    It rides in extra_body because it is not an OpenAI parameter: the client
    passes the field through untouched, and a provider that does not know it
    ignores it. Empty — or an endpoint that has already refused one — leaves
    the model's own default in place.
    """
    if not effort or model in _refuses_budget:
        return {}
    return {"extra_body": {"reasoning": {"effort": effort}}}


def budget_was_refused(error: BaseException) -> bool:
    """Whether a failure is the endpoint objecting to the thinking budget."""
    return "reasoning" in str(error).lower()


def drop_budget(model: str) -> bool:
    """Stop sending a budget to this model, and rebuild the clients.

    Returns False when it was already dropped, which is what stops a retry
    loop: the second failure is a real one and belongs to the caller.
    """
    if model in _refuses_budget:
        return False
    logger.warning("%s refuses a reasoning budget — sending none from now on", model)
    _refuses_budget.add(model)
    get_model.cache_clear()
    get_router_model.cache_clear()
    return True


def answering_model() -> str:
    return settings.model


def labelling_model() -> str:
    return settings.router_model or settings.model


def _credentials() -> dict:
    """Where both models get their key and endpoint from.

    Passed explicitly rather than left to each provider SDK's own environment
    variable, so the service is configured by one pair of names whatever
    vendor is behind them. Either half unset falls back to the provider's
    default — its own key variable, its own endpoint.

    An aggregator (OpenRouter) speaks the OpenAI wire for every vendor, so
    "openai:<vendor>/<model>" plus its base URL reaches any of them with the
    one key that service issued.
    """
    credentials = {}
    if settings.model_api_key:
        credentials["api_key"] = settings.model_api_key
    if settings.model_base_url:
        credentials["base_url"] = settings.model_base_url
    return credentials


@cache  # lazy singleton: the client is built once and reused by every request
def get_model() -> BaseChatModel:
    return init_chat_model(
        settings.model,
        max_tokens=settings.max_tokens,
        timeout=settings.request_timeout_s,
        **_credentials(),
        **_reasoning(settings.reasoning_effort, answering_model()),
    )


@cache
def get_router_model() -> BaseChatModel:
    """The model that labels turns (app/intent.py).

    Routers ride the cheapest model that labels reliably — their output is a
    dozen tokens, so intelligence is bought where it matters and pennies are
    spent where it does not. Defaults to the main model (already the cheap
    tier); AGENT_ROUTER_MODEL overrides it independently.
    """
    return init_chat_model(
        settings.router_model or settings.model,
        max_tokens=200,
        timeout=settings.request_timeout_s,
        **_credentials(),
        **_reasoning(settings.router_reasoning_effort, labelling_model()),
    )


def extract_text(reply: BaseMessage) -> str:
    """The reply's text, whatever shape it arrived in.

    Content comes back as a plain string OR as a list of blocks (models that
    think before answering return [thinking, text, ...]); only the text blocks
    are the answer.
    """
    if isinstance(reply.content, str):
        return reply.content
    return "".join(
        block.get("text", "")
        for block in reply.content
        if isinstance(block, dict) and block.get("type") == "text"
    )
