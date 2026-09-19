from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = Field(default=None, max_length=64)
    portfolio: str | None = Field(default=None, max_length=128)


class TextBlock(BaseModel):
    kind: Literal["text"] = "text"
    text: str


class TraceStep(BaseModel):
    id: str
    label: str
    state: str
    detail: str | None = None
    ms: int | None = None


class TraceBlock(BaseModel):
    kind: Literal["trace"] = "trace"
    steps: list[TraceStep]


class SignInBlock(BaseModel):
    kind: Literal["signin"] = "signin"
    title: str
    sub: str
    pending_question: str | None = Field(default=None, serialization_alias="pendingQuestion")


class DepositBlock(BaseModel):
    kind: Literal["deposit"] = "deposit"
    pool_id: str = Field(serialization_alias="poolId")
    pool: str
    protocol: str
    pool_kind: str = Field(serialization_alias="poolKind")
    network: str
    token: str
    amount: str
    apy: str
    risk: str
    url: str


class ChatSummary(BaseModel):
    id: str
    title: str
    at: int


class ChatTurn(BaseModel):
    q: str
    a: str
    at: int
    blocks: list[dict] = Field(default_factory=list)


class ChatDetail(BaseModel):
    schema_version: int = Field(default=1, serialization_alias="schema")
    id: str
    title: str
    at: int
    turns: list[ChatTurn]


class ChatList(BaseModel):
    schema_version: int = Field(default=1, serialization_alias="schema")
    chats: list[ChatSummary]


class ChatResponse(BaseModel):
    schema_version: int = Field(default=1, serialization_alias="schema")
    blocks: list[TraceBlock | TextBlock | SignInBlock | DepositBlock]
    reply: str
    session_id: str
