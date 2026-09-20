import asyncio
import logging
import time
from collections.abc import Callable, Sequence
from typing import Any

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.runnables import Runnable

from ..config import Role
from ..domain.house import plain
from ..observability import metrics
from ..settings import Settings

logger = logging.getLogger("svinooh-ai")

Factory = Callable[..., BaseChatModel]

Prepare = Callable[[BaseChatModel], Runnable[Any, Any]]


class Models:
    def __init__(self, settings: Settings, factory: Factory = init_chat_model) -> None:
        self._settings = settings
        self._factory = factory
        self._clients: dict[Role, BaseChatModel] = {}
        self._in_flight = asyncio.Semaphore(settings.model_max_in_flight)
        self._no_longer_asked_to_think: set[str] = set()

    def for_role(self, role: Role) -> BaseChatModel:
        client = self._clients.get(role)
        if client is None:
            client = self._factory(
                role.model,
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
        async with self._in_flight:
            metrics.in_flight(1)
            started, outcome = time.perf_counter(), "ok"
            try:
                return await self._runnable(role, prepare).ainvoke(messages)
            except Exception as error:
                if not (is_thinking_setting_rejected(error) and self.stop_asking_it_to_think(role)):
                    outcome = "failed"
                    raise
                try:
                    return await self._runnable(role, prepare).ainvoke(messages)
                except Exception:
                    outcome = "failed"
                    raise
            finally:
                metrics.in_flight(-1)
                metrics.timed(metrics.model_duration, time.perf_counter() - started, role=role.name)
                metrics.counted(metrics.model_calls, role=role.name, outcome=outcome)

    def _runnable(self, role: Role, prepare: Prepare | None) -> Runnable[Any, Any]:
        client = self.for_role(role)
        return prepare(client) if prepare is not None else client

    @property
    def no_longer_asked_to_think(self) -> frozenset[str]:
        return frozenset(self._no_longer_asked_to_think)

    def stop_asking_it_to_think(self, role: Role) -> bool:
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
        if not self._speaks_openai_wire(role.model):
            return {}
        body = self._provider_policy(role.provider_sort)
        if role.reasoning_effort and role.model not in self._no_longer_asked_to_think:
            body["reasoning"] = {"effort": role.reasoning_effort}
        return {"extra_body": body} if body else {}

    def _speaks_openai_wire(self, model: str) -> bool:
        return bool(self._settings.model_base_url) or model.startswith("openai:")

    def _provider_policy(self, sort: str) -> dict[str, Any]:
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
        credentials = {}
        if self._settings.model_api_key:
            credentials["api_key"] = self._settings.model_api_key
        if self._settings.model_base_url:
            credentials["base_url"] = self._settings.model_base_url
        return credentials


def is_thinking_setting_rejected(error: BaseException) -> bool:
    text = str(error).lower()
    return "reasoning" in text or "no endpoints found that can handle the requested" in text


def structured(model: BaseChatModel, schema: Any) -> Runnable[Any, Any]:
    return model.with_structured_output(schema, method="function_calling")


def extract_text(reply: BaseMessage) -> str:
    if isinstance(reply.content, str):
        return plain(reply.content)
    return plain(
        "".join(
            block.get("text", "")
            for block in reply.content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    )
