"""The wire types — the whole vocabulary the outside world and this service share.

Request/response models, the standard FastAPI pattern: pydantic classes that
describe the HTTP contract. FastAPI validates every request body against them
(a bad body is a 422 before our code runs), serializes responses through them,
and generates the OpenAPI docs (/docs) from them.
"""
from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str
    # Continues an earlier conversation. Absent — a new session is started and
    # its id returned, so holding context is the caller's choice, not a demand.
    session_id: str | None = None
    # The portfolio slug the user is looking at. With it (and the caller's
    # Authorization header) the answer is grounded in that portfolio's live
    # numbers; without it the agent answers generally.
    portfolio: str | None = None


class TextBlock(BaseModel):
    """The first (and so far only) block the service emits.

    The block vocabulary is the wire contract (DESIGN.md): the widget renders
    blocks and knows nothing else, so richer answers — stats, charts, the
    sign-in block — are new block kinds emitted here, never a new endpoint.
    """

    kind: Literal["text"] = "text"
    text: str


class ChatResponse(BaseModel):
    # The contract's version stamp, so a widget can refuse a wire it does not
    # speak instead of rendering garbage. (Named schema_version in code only
    # because `schema` collides with pydantic's own namespace; on the wire it
    # is "schema".)
    schema_version: int = Field(default=1, serialization_alias="schema")
    blocks: list[TextBlock]
    # Transitional, expand-then-contract: the gateway-era web tab reads
    # `reply`, the widget will read `blocks` — the field is deleted with the
    # gateway, and no consumer ever sees a wire it cannot parse.
    reply: str
    # Echoed (or freshly issued) so the caller can send it back next turn.
    session_id: str
