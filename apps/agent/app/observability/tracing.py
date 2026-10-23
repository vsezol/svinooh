import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from langchain_core.runnables import RunnableConfig
from langfuse import Langfuse, propagate_attributes
from langfuse.langchain import CallbackHandler
from langfuse.types import MaskOtelSpansParams, MaskOtelSpansResult, OtelSpanPatch

from ..ports import Ask

SECRETS = re.compile(r"Bearer\s+[\w.~+/=-]+|eyJ[\w-]+\.[\w-]+\.[\w-]*")


def configure(**options: Any) -> None:
    if os.getenv("LANGFUSE_PUBLIC_KEY"):
        Langfuse(mask_otel_spans=redact_secrets, **options)


@contextmanager
def traced(ask: Ask, enabled: bool = True) -> Iterator[RunnableConfig | None]:
    """The turn's trace in Langfuse, unless there are no keys or the panel turned it off."""
    if not enabled or not os.getenv("LANGFUSE_PUBLIC_KEY"):
        yield None
        return
    with propagate_attributes(session_id=ask.session_id or None, user_id=ask.owner or None):
        yield {"callbacks": [CallbackHandler()]}


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
