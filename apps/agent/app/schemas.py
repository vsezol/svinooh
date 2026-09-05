"""The wire types — the whole vocabulary the outside world and this service share.

Request/response models, the standard FastAPI pattern: pydantic classes that
describe the HTTP contract. FastAPI validates every request body against them
(a bad body is a 422 before our code runs), serializes responses through them,
and generates the OpenAPI docs (/docs) from them.
"""
from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    # Continues an earlier conversation. Absent — a new session is started and
    # its id returned, so holding context is the caller's choice, not a demand.
    session_id: str | None = None
    # The portfolio slug the user is looking at. With it (and the caller's
    # Authorization header) the answer is grounded in that portfolio's live
    # numbers; without it the agent answers generally.
    portfolio: str | None = None


class ChatResponse(BaseModel):
    reply: str
    # Echoed (or freshly issued) so the caller can send it back next turn.
    session_id: str
