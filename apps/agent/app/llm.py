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
from functools import cache

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage

from .config import settings


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
