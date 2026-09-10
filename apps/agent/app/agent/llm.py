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

from ..composition import config
from ..config import Role

logger = logging.getLogger("svinooh-ai")


# Models we have stopped sending a thinking setting to, because their endpoint
# would not take one. It refuses in either direction — some insist on thinking
# and reject a request to do less of it, others have no thinking to do and are
# filtered away for being asked — and either refusal would otherwise kill every
# turn for as long as our setting stood.
_models_we_no_longer_ask_to_think: set[str] = set()


def _wire_options(role: Role) -> dict:
    """Everything this role wants that is not an OpenAI parameter.

    All of it rides in extra_body: the client passes those fields through
    untouched, and a provider that does not know one ignores it. That covers
    both the thinking setting and the provider policy, which is why they are
    assembled together and why both are for the OpenAI wire only.

    An empty thinking setting — or an endpoint that has already refused one —
    leaves the model's own default in place.
    """
    if not _speaks_openai_wire(role.model):
        return {}
    body = _provider_policy(role.provider_sort)
    if role.reasoning_effort and role.model not in _models_we_no_longer_ask_to_think:
        body["reasoning"] = {"effort": role.reasoning_effort}
    return {"extra_body": body} if body else {}


def _speaks_openai_wire(model: str) -> bool:
    """Whether extra_body means anything for this model.

    It is an OpenAI-client field: on the Anthropic client it is not a
    parameter at all, and langchain quietly moves it to model_kwargs while
    warning that nobody meant this. Reasoning budgets and provider policies
    both ride in it, so both are for the OpenAI wire only — which is the wire
    an aggregator speaks for every vendor anyway.
    """
    return bool(config.settings.model_base_url) or model.startswith("openai:")


def _provider_policy(sort: str) -> dict:
    """Which providers behind an aggregator may serve our prompts.

    Only meaningful when a base URL is set: without an aggregator there is one
    provider and nothing to choose between.

    The privacy half is the service's and applies to every role — these prompts
    carry wallet addresses whoever is reading them. The sort is the role's,
    because "best provider" means different things to a job that writes
    paragraphs and a job that writes one word.
    """
    if not config.settings.model_base_url:
        return {}
    policy: dict = {}
    if config.settings.provider_data_collection:
        policy["data_collection"] = config.settings.provider_data_collection
    if config.settings.provider_require_parameters:
        policy["require_parameters"] = True
    if sort:
        policy["sort"] = sort
    return {"provider": policy} if policy else {}


def is_thinking_setting_rejected(error: BaseException) -> bool:
    """Whether a failure is the endpoint refusing the thinking setting we sent.

    It comes back as two different failures that mean the same sentence.

    A model that thinks, told to think less than it wants, answers 400 and says
    so: "reasoning is mandatory for this endpoint".

    A model that does not think at all is not asked — it is filtered. We tell
    the aggregator a provider must support every parameter we send, because
    tools are not optional for this agent; asking an instruct model to think
    puts a parameter in that list which none of its providers has, so every
    endpoint is filtered out and there is nothing left to route to. That
    arrives as a 404 about the requested parameters, from the routing step that
    filters by them.
    """
    text = str(error).lower()
    return "reasoning" in text or "no endpoints found that can handle the requested" in text


def stop_asking_it_to_think(role: Role) -> bool:
    """Drop this role's thinking setting for good, and rebuild the clients.

    Returns False when there is nothing to drop — the role never sent one, or
    we already stopped — which is what ends a retry instead of looping: the
    failure is then a real one and belongs to the caller.

    Gating on the role's own setting matters. "No endpoints" can also be said
    about a parameter we are not willing to give up, and a wrong guess must not
    quietly relax a role that was configured on purpose.
    """
    if not role.reasoning_effort or role.model in _models_we_no_longer_ask_to_think:
        return False
    logger.warning(
        "%s will not take reasoning=%s — no longer sending one for the %s role",
        role.model,
        role.reasoning_effort,
        role.name,
    )
    _models_we_no_longer_ask_to_think.add(role.model)
    model_for.cache_clear()
    return True


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
    if config.settings.model_api_key:
        credentials["api_key"] = config.settings.model_api_key
    if config.settings.model_base_url:
        credentials["base_url"] = config.settings.model_base_url
    return credentials


@cache  # lazy singleton per role: a client is built once and reused
def model_for(role: Role) -> BaseChatModel:
    """The client for one job, built from that job's own settings."""
    return init_chat_model(
        role.model,
        # langchain's own name for it; ours says what it caps.
        max_tokens=role.answer_token_cap,
        timeout=config.settings.request_timeout_s,
        **_credentials(),
        **_wire_options(role),
    )


def get_model() -> BaseChatModel:
    """The model that answers — what the user reads."""
    return model_for(config.answering())


def get_router_model() -> BaseChatModel:
    """The model that labels — the intent and confirmation classifiers."""
    return model_for(config.labelling())


async def ask(build, messages, role: Role, forget=None):
    """Send messages to a model, surviving the one failure worth surviving.

    Every call site had the same six lines around it, which is five lines more
    than the idea is worth: try, and if the endpoint turned out to refuse the
    thinking setting we sent, stop sending it and try once more. Any other
    failure, and any second failure, belongs to the caller — there is no loop
    here.

    `build` returns the runnable rather than being one, because a caller's
    runnable is usually cached and the retry needs a freshly built one;
    `forget` clears that cache.
    """
    try:
        return await build().ainvoke(messages)
    except Exception as error:
        if not (is_thinking_setting_rejected(error) and stop_asking_it_to_think(role)):
            raise
        if forget is not None:
            forget()
        return await build().ainvoke(messages)


def structured(model: BaseChatModel, schema):
    """Make a model answer in a schema's shape, the way most providers can.

    There are two ways to ask, and they are not equally available. The library
    now defaults to `json_schema`, which sends `response_format` and needs a
    provider advertising `structured_outputs`. `function_calling` describes the
    schema as a tool the model must call, and needs `tools`.

    Every provider of our models supports tools; four of the answering model's
    fifteen do not support structured outputs. That gap is invisible until it
    meets `require_parameters` — which we send because tools are not optional
    here — and then it is not a gap, it is a filter: the narrower ask, crossed
    with our refusal of providers that train on what we send, left nothing to
    route to and the classifier failed on every request.

    So we ask the wide way, on purpose, rather than taking whichever way the
    library currently prefers. `tools` is the parameter we already insist on;
    asking for a second one buys a guarantee we do not need and costs a
    quarter of the providers.
    """
    return model.with_structured_output(schema, method="function_calling")


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
