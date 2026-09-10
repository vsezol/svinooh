"""A turn, as it is being written rather than once it is finished.

The whole answer took four to six seconds to arrive, and for all of them the
chat showed nothing: not the service thinking, but the model writing into a
buffer nobody could see. Streaming does not make an answer faster; it stops
us hiding one that was arriving all along.

The graph can be watched instead of awaited. Asked for three modes at once it
reports the steps nodes announce, the tokens leaving every model it runs, and
the state each node returns — so the turn still ends in exactly the state the
non-streaming path ends in. The tokens are a view of the work, not a second
way of doing it.
"""

import logging
from collections.abc import AsyncIterator, Collection
from typing import Any

from .llm import extract_text

logger = logging.getLogger("svinooh-ai")


async def turn_events(
    graph: Any, state: dict, *, answering: Collection[str]
) -> AsyncIterator[tuple[str, dict]]:
    """Run one turn on the graph, reporting it as it happens.

    Yields `("step", ...)` as operations start and finish and
    `("token", {"text": ...})` as the answer is written, then exactly one
    `("done", final_state)` or one `("error", ...)`. Only the nodes in
    `answering` stream tokens: labelling a question and reading a reply for a
    yes both run models, and neither is for the reader.

    The last event carries the finished answer and is what a caller trusts.
    The tokens are the preview: a branch that looks things up writes tool
    calls on the way, and one that answers from a fixed sentence writes none.
    """
    final: dict[str, Any] = {}
    try:
        async for mode, chunk in graph.astream(state, stream_mode=["custom", "messages", "values"]):
            if mode == "values":
                final = chunk if isinstance(chunk, dict) else final
                continue
            if mode == "custom":
                # A node saying what it is doing, passed through untouched
                # (app/agent/steps.py); this layer does not describe the work.
                if isinstance(chunk, dict):
                    yield "step", chunk
                continue
            message, meta = chunk
            if meta.get("langgraph_node") not in answering:
                continue
            text = extract_text(message)
            if text:
                yield "token", {"text": text}
    except Exception as error:  # noqa: BLE001 — the reader gets an ending either way
        logger.warning("turn failed mid-stream: %r", error)
        yield "error", {"message": "the answer could not be finished"}
        return

    if not final.get("answer"):
        # A turn that ends without an answer is a bug upstream, but the reader
        # is owed an ending rather than a connection that simply stops.
        logger.warning("turn produced no answer: %s", sorted(final))
        yield "error", {"message": "the answer could not be finished"}
        return
    yield "done", final
