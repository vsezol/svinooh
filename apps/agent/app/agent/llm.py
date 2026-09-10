"""The model clients, behind a provider-neutral seam.

No provider SDK is imported here: init_chat_model resolves "<provider>:<model>"
at call time, so switching vendors is a new AGENT_MODEL value plus that
vendor's langchain package — never an import change. Clients are built on
first use and reused: the service boots and answers /health before any key
is set, and what is per request is the API call, not the client.
"""

import asyncio
import logging
from collections.abc import Callable, Sequence
from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.runnables import Runnable

from ..config import Role
from ..settings import Settings

logger = logging.getLogger("svinooh-ai")

#: How a client is built from a model name: the vendor call, replaceable in tests.
Factory = Callable[..., BaseChatModel]

#: What a call needs from the client before it is made: tools bound, or a
#: schema to answer in. Applied again to a fresh client on a retry.
Prepare = Callable[[BaseChatModel], Runnable[Any, Any]]


class Models:
    """One client per role, built lazily, and the one retry worth having."""

    def __init__(self, settings: Settings, factory: Factory = init_chat_model) -> None:
        self._settings = settings
        self._factory = factory
        self._clients: dict[Role, BaseChatModel] = {}
        # How many calls may be in the air at once, across every turn this
        # process is serving. The provider limits us anyway; queueing here
        # means a burst waits in one place we can measure, rather than
        # arriving at the provider as a wall of 429s that each cost a turn.
        self._in_flight = asyncio.Semaphore(settings.model_max_in_flight)
        # Models whose endpoint refused a thinking setting, in either
        # direction: some insist on thinking, others have none to do and are
        # filtered away for being asked. Either refusal would otherwise kill
        # every turn for as long as our setting stood.
        self._no_longer_asked_to_think: set[str] = set()

    def for_role(self, role: Role) -> BaseChatModel:
        """The client for one job, built from that job's own dials."""
        client = self._clients.get(role)
        if client is None:
            client = self._factory(
                role.model,
                # langchain's own name for it; ours says what it caps.
                max_tokens=role.answer_token_cap,
                timeout=self._settings.request_timeout_s,
                **self._credentials(),
                **self.wire_options(role),
            )
            self._clients[role] = client
        return client

    async def ask(
        self, role: Role, messages: Sequence[BaseMessage], prepare: Prepare | None = None
    ) -> Any:
        """Send messages to the role's model, surviving the one failure worth surviving.

        If the endpoint refused the thinking setting we sent, stop sending it
        and try once more on a fresh client. Any other failure, and any second
        one, belongs to the caller — there is no loop here.
        """
        async with self._in_flight:
            try:
                return await self._runnable(role, prepare).ainvoke(messages)
            except Exception as error:
                if not (is_thinking_setting_rejected(error) and self.stop_asking_it_to_think(role)):
                    raise
                # Still holding its place in the queue: the retry is the same
                # call, and letting go here would send it to the back.
                return await self._runnable(role, prepare).ainvoke(messages)

    def _runnable(self, role: Role, prepare: Prepare | None) -> Runnable[Any, Any]:
        client = self.for_role(role)
        return prepare(client) if prepare is not None else client

    @property
    def no_longer_asked_to_think(self) -> frozenset[str]:
        return frozenset(self._no_longer_asked_to_think)

    def stop_asking_it_to_think(self, role: Role) -> bool:
        """Drop this role's thinking setting for good, and forget its clients.

        False when there is nothing to drop — the role never sent one, or we
        already stopped — which is what ends a retry instead of looping. Gated
        on the role's own setting: "no endpoints" can also be said about a
        parameter we are not willing to give up.
        """
        if not role.reasoning_effort or role.model in self._no_longer_asked_to_think:
            return False
        logger.warning(
            "%s will not take reasoning=%s — no longer sending one for the %s role",
            role.model,
            role.reasoning_effort,
            role.name,
        )
        self._no_longer_asked_to_think.add(role.model)
        for built in [known for known in self._clients if known.model == role.model]:
            del self._clients[built]
        return True

    def wire_options(self, role: Role) -> dict[str, Any]:
        """Everything this role wants that is not an OpenAI parameter.

        All of it rides in extra_body, which the client passes through
        untouched and a provider ignores when it does not know it: the
        thinking setting and the provider policy, both for the OpenAI wire
        only — the wire an aggregator speaks for every vendor anyway.
        """
        if not self._speaks_openai_wire(role.model):
            return {}
        body = self._provider_policy(role.provider_sort)
        if role.reasoning_effort and role.model not in self._no_longer_asked_to_think:
            body["reasoning"] = {"effort": role.reasoning_effort}
        return {"extra_body": body} if body else {}

    def _speaks_openai_wire(self, model: str) -> bool:
        # extra_body is an OpenAI-client field; on the Anthropic client it is
        # not a parameter at all, and langchain quietly moves it aside.
        return bool(self._settings.model_base_url) or model.startswith("openai:")

    def _provider_policy(self, sort: str) -> dict[str, Any]:
        """Which providers behind an aggregator may serve our prompts.

        The privacy half is the service's and applies to every role: these
        prompts carry wallet addresses whoever reads them. The sort is the
        role's, because "best provider" differs between a job that writes
        paragraphs and one that writes a word.
        """
        settings = self._settings
        if not settings.model_base_url:
            return {}
        policy: dict[str, Any] = {}
        if settings.provider_data_collection:
            policy["data_collection"] = settings.provider_data_collection
        if settings.provider_require_parameters:
            policy["require_parameters"] = True
        if sort:
            policy["sort"] = sort
        return {"provider": policy} if policy else {}

    def _credentials(self) -> dict[str, str]:
        """One key and one endpoint for every vendor, named by us.

        An aggregator speaks the OpenAI wire for every vendor, so
        "openai:<vendor>/<model>" plus its base URL reaches any of them with
        the one key that service issued. Either half unset falls back to the
        provider's own environment variable and endpoint.
        """
        credentials = {}
        if self._settings.model_api_key:
            credentials["api_key"] = self._settings.model_api_key
        if self._settings.model_base_url:
            credentials["base_url"] = self._settings.model_base_url
        return credentials


def is_thinking_setting_rejected(error: BaseException) -> bool:
    """Whether a failure is the endpoint refusing the thinking setting we sent.

    Two failures mean the same sentence. A model that thinks, told to think
    less than it wants, answers 400: "reasoning is mandatory". A model that
    does not think at all is filtered away for being asked — a 404 about the
    requested parameters, from the routing step that filters by them.
    """
    text = str(error).lower()
    return "reasoning" in text or "no endpoints found that can handle the requested" in text


def structured(model: BaseChatModel, schema: Any) -> Runnable[Any, Any]:
    """Make a model answer in a schema's shape, the way most providers can.

    `function_calling` describes the schema as a tool the model must call and
    needs only `tools`, which every provider of ours supports. The library's
    default, `json_schema`, needs `structured_outputs`, which a quarter of them
    lack — and crossed with our provider policy that left nothing to route to.
    """
    return model.with_structured_output(schema, method="function_calling")


def extract_text(reply: BaseMessage) -> str:
    """The reply's text, whatever shape it arrived in.

    Content is a plain string or a list of blocks (models that think first
    return [thinking, text, ...]); only the text blocks are the answer.
    """
    if isinstance(reply.content, str):
        return reply.content
    return "".join(
        block.get("text", "")
        for block in reply.content
        if isinstance(block, dict) and block.get("type") == "text"
    )
