import asyncio
import hashlib
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from langchain_core.runnables import RunnableConfig
from langfuse import Langfuse, LangfuseAgent, propagate_attributes
from langfuse.langchain import CallbackHandler
from langfuse.types import MaskOtelSpansParams, MaskOtelSpansResult, OtelSpanPatch

from ..ports import Ask, Reply
from ..settings import Settings
from .logs import request_id

TURN = "answer-turn"

SECRETS = re.compile(r"Bearer\s+[\w.~+/=-]+|eyJ[\w-]+\.[\w-]+\.[\w-]*")


@dataclass
class TracedTurn:
    observation: LangfuseAgent | None = None
    config: RunnableConfig | None = None

    def answered(self, reply: Reply, decided: dict[str, str]) -> None:
        if self.observation is not None:
            self.observation.update(output=reply, metadata=decided)

    def failed(self, message: str) -> None:
        if self.observation is not None:
            self.observation.update(level="ERROR", status_message=message)


class Tracing:
    def __init__(self, settings: Settings | None = None, **langfuse_options: Any) -> None:
        self._langfuse: Langfuse | None = None
        self._public_key = ""
        if settings and settings.langfuse_public_key and settings.langfuse_secret_key:
            self._public_key = settings.langfuse_public_key
            self._langfuse = Langfuse(
                public_key=settings.langfuse_public_key,
                secret_key=settings.langfuse_secret_key,
                release=settings.release or None,
                mask_otel_spans=redact_secrets,
                **langfuse_options,
            )

    @contextmanager
    def turn(self, ask: Ask) -> Iterator[TracedTurn]:
        if self._langfuse is None:
            yield TracedTurn()
            return
        with (
            self._langfuse.start_as_current_observation(
                name=TURN, as_type="agent", input=asked(ask)
            ) as observation,
            propagate_attributes(
                trace_name=TURN,
                session_id=ask.session_id or None,
                user_id=pseudonym(ask.owner),
                metadata={"request_id": request_id.get()} if request_id.get() else None,
            ),
        ):
            yield TracedTurn(
                observation, {"callbacks": [CallbackHandler(public_key=self._public_key)]}
            )

    def flush(self) -> None:
        if self._langfuse is not None:
            self._langfuse.flush()

    async def stop(self) -> None:
        if self._langfuse is not None:
            await asyncio.to_thread(self._langfuse.shutdown)


def asked(ask: Ask) -> dict[str, Any]:
    return {
        "question": ask.question,
        "portfolio": ask.portfolio,
        "settled": ask.settled,
        "turns_before": len(ask.history),
    }


def pseudonym(owner: str) -> str | None:
    return hashlib.sha256(owner.encode()).hexdigest()[:16] if owner else None


def redact_secrets(*, params: MaskOtelSpansParams) -> MaskOtelSpansResult | None:
    patches = {}
    for identifier, span in params.spans.items():
        redacted = {
            key: SECRETS.sub("[redacted]", value)
            for key, value in span.attributes.items()
            if isinstance(value, str) and SECRETS.search(value)
        }
        if redacted:
            patches[identifier] = OtelSpanPatch(set_attributes=redacted)
    return MaskOtelSpansResult(span_patches=patches) if patches else None
