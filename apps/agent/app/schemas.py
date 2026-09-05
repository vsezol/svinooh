"""The wire types — the whole vocabulary the outside world and this service share."""
from pydantic import BaseModel


class ChatIn(BaseModel):
    message: str
    # Continues an earlier conversation. Absent — a new session is started and
    # its id returned, so holding context is the caller's choice, not a demand.
    session_id: str | None = None


class ChatOut(BaseModel):
    reply: str
    # Echoed (or freshly issued) so the caller can send it back next turn.
    session_id: str
