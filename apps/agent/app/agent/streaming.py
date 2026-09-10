"""A turn, as it is being written rather than once it is finished.

The whole answer took four to six seconds to arrive, and for all of them the
chat showed nothing. Almost none of that was the service thinking — it was the
model writing, at a speed a person reads comfortably, into a buffer nobody
could see. Streaming does not make an answer faster; it stops us hiding one
that was arriving all along.

What makes this possible without restructuring anything is that the graph can
be watched instead of awaited. Asked for two modes at once it reports both the
tokens leaving every model it runs and the state each node returns, so the
turn still ends in exactly the state the non-streaming path ends in — the
tokens are a view of the work, not a second way of doing it.

The events are named for what the reader is doing, not for what the transport
is: something is coming, here is a piece of it, that was all of it, that went
wrong.
"""
import logging
from collections.abc import AsyncIterator
from typing import Any

from .graph import ANSWERING_NODES, agent_graph
from .llm import extract_text

logger = logging.getLogger("svinooh-ai")


async def turn_events(state: dict) -> AsyncIterator[tuple[str, dict]]:
    """Run one turn, reporting it as it happens.

    Yields `("step", ...)` as each operation starts and finishes and
    `("token", {"text": ...})` as the answer is written, then exactly one
    `("done", final_state)`, or one `("error", ...)` if the turn failed.
    Nothing after either — a caller can treat the first of those as the end.

    Two things are deliberately not the same. Tokens are what the model is
    writing; the answer is what the graph decided a turn produced. Usually they
    are the same text, but a branch that looks something up writes tool calls
    on the way, and a branch that answers from a fixed sentence writes no
    tokens at all. So the last event carries the finished answer and the caller
    trusts that, treating the tokens as the preview they are.
    """
    final: dict[str, Any] = {}
    try:
        async for mode, chunk in agent_graph().astream(
            state, stream_mode=["custom", "messages", "values"]
        ):
            if mode == "values":
                final = chunk if isinstance(chunk, dict) else final
                continue
            if mode == "custom":
                # A node saying what it is doing. Passed through untouched:
                # this layer has no idea what the work was and is not the place
                # to start describing it (app/steps.py).
                if isinstance(chunk, dict):
                    yield "step", chunk
                continue
            message, meta = chunk
            # Labelling a question and checking a reply for a yes both run
            # models, and neither is being read by anybody.
            if meta.get("langgraph_node") not in ANSWERING_NODES:
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
