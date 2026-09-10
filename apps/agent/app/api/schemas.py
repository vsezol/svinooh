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


class SignInBlock(BaseModel):
    """The answer once a visitor's free questions are spent.

    The second block kind, and the first that is not an answer: it is what the
    service says INSTEAD of one. It carries the question so the widget can ask
    it again by itself once the auth flow returns — the person typed it, was
    shown a door instead of an answer, and should not have to type it twice.
    """

    kind: Literal["signin"] = "signin"
    title: str
    sub: str
    #: camelCase on the wire, like every other multi-word field the widget reads.
    pending_question: str | None = Field(
        default=None, serialization_alias="pendingQuestion"
    )


class ChatSummary(BaseModel):
    """A conversation as a row in a list — what a rail needs to draw one."""

    id: str
    title: str
    #: When it was last spoken to, epoch ms. The client formats it relatively.
    at: int


class ChatTurn(BaseModel):
    """One exchange, as both things it is.

    `blocks` is what the reader saw; `a` is the same answer as the text the
    model is replayed. One record with two projections rather than two records
    — see app/store.py. The client renders `blocks` and never has to rebuild
    them from `a`, which would be a layer guessing what to draw.
    """

    q: str
    a: str
    at: int
    blocks: list[dict] = Field(default_factory=list)


class ChatDetail(BaseModel):
    """One conversation, whole, for reopening it from its URL."""

    schema_version: int = Field(default=1, serialization_alias="schema")
    id: str
    title: str
    at: int
    turns: list[ChatTurn]


class ChatList(BaseModel):
    schema_version: int = Field(default=1, serialization_alias="schema")
    chats: list[ChatSummary]


class ChatResponse(BaseModel):
    # The contract's version stamp, so a widget can refuse a wire it does not
    # speak instead of rendering garbage. (Named schema_version in code only
    # because `schema` collides with pydantic's own namespace; on the wire it
    # is "schema".)
    schema_version: int = Field(default=1, serialization_alias="schema")
    # A union, which is what "the vocabulary grows additively" means in
    # practice: a widget that does not know a kind skips it, and one that does
    # renders it, without either end changing endpoint.
    blocks: list[TextBlock | SignInBlock]
    # Transitional, expand-then-contract: the gateway-era web tab reads
    # `reply`, the widget will read `blocks` — the field is deleted with the
    # gateway, and no consumer ever sees a wire it cannot parse.
    reply: str
    # Echoed (or freshly issued) so the caller can send it back next turn.
    session_id: str
