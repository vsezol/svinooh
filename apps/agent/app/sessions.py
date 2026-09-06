"""Conversation memory — the smallest honest version of what production does.

The model API is stateless: "context" in every production system is the server
keeping the conversation and replaying it into each call. This store is that
mechanism, per session_id — in memory, capped, expiring. In memory means
per-instance and gone on restart; the production step up is an external store
(Redis, a database, or a LangGraph checkpointer) behind this same class, and
the roadmap keeps that inside this service, never in the widget.

Deliberately NOT a chat-history feature. "Open my past conversations" is a
product feature that needs durable storage keyed by user — the agent's own
store (its own small DB/Redis, never the portfolio's database, so independence
holds), which becomes possible once token validation tells this
service who the user is. This class is only the working context of a live
conversation, which is why losing it on restart is acceptable.
"""
import time
import uuid

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage


class SessionStore:
    def __init__(self, max_messages: int, ttl_s: int):
        self._max = max_messages
        self._ttl = ttl_s
        # session_id -> (last touched at, messages so far)
        self._sessions: dict[str, tuple[float, list[BaseMessage]]] = {}

    def new_id(self) -> str:
        return uuid.uuid4().hex

    def history(self, session_id: str) -> list[BaseMessage]:
        self._evict()
        entry = self._sessions.get(session_id)
        return list(entry[1]) if entry else []

    def append(self, session_id: str, question: str, answer: str) -> None:
        _, messages = self._sessions.get(session_id, (0.0, []))
        messages = messages + [HumanMessage(content=question), AIMessage(content=answer)]
        # Oldest turns fall off the front: the cap bounds both memory here and
        # tokens on every model call, and recent turns are the ones that matter.
        self._sessions[session_id] = (time.time(), messages[-self._max :])

    def _evict(self) -> None:
        """Lazily forget sessions nobody has touched for the TTL.

        Called on the read path rather than by a timer: with no background task
        there is nothing extra to crash, and a store that is never read grows
        by at most what its callers sent.
        """
        deadline = time.time() - self._ttl
        dead = [sid for sid, (touched, _) in self._sessions.items() if touched < deadline]
        for sid in dead:
            del self._sessions[sid]
