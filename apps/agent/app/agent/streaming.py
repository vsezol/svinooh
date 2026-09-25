import logging
from collections.abc import AsyncIterator, Collection
from typing import Any

from .llm import extract_text

logger = logging.getLogger("svinooh-ai")

BETWEEN_REPLIES = "\n\n"


async def turn_events(
    graph: Any, state: dict, *, answering: Collection[str]
) -> AsyncIterator[tuple[str, dict]]:
    final: dict[str, Any] = {}
    spoken = False
    speaking: str | None = None
    try:
        async for mode, chunk in graph.astream(state, stream_mode=["custom", "messages", "values"]):
            if mode == "values":
                final = chunk if isinstance(chunk, dict) else final
                continue
            if mode == "custom":
                if isinstance(chunk, dict):
                    yield "step", chunk
                continue
            message, meta = chunk
            if meta.get("langgraph_node") not in answering:
                continue
            text = extract_text(message)
            if not text:
                continue
            if spoken and message.id is not None and message.id != speaking:
                yield "token", {"text": BETWEEN_REPLIES}
            speaking = message.id or speaking
            spoken = True
            yield "token", {"text": text}
    except Exception as error:  # noqa: BLE001 — the reader gets an ending either way
        logger.warning("turn failed mid-stream: %r", error)
        yield "error", {"message": "the answer could not be finished"}
        return

    if not (final.get("answer") or final.get("choices") or final.get("deposits")):
        logger.warning("turn produced no answer: %s", sorted(final))
        yield "error", {"message": "the answer could not be finished"}
        return
    yield "done", final
