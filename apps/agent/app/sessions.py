"""Conversation memory — and now the conversations themselves.

The model API is stateless: "context" in every production system is the server
keeping the conversation and replaying it into each call. This store is that
mechanism — and, since the store became durable, it is also the product
feature the note here used to promise for later: past conversations, kept in
the agent's own store (app/store.py), never the portfolio's database, so the
service's independence holds.

The two turned out to be one thing, which is the whole point of this class.
A conversation is stored **once**, as its turns. What the model is replayed is
a projection of those turns (`history`, the last N rendered as messages) and
what the reader sees is another (`chat`, the turns with their blocks). Keeping
a message list beside the transcript would be two copies of one conversation —
the split that made a restart lose the thread while the transcript stayed on
screen.

The interface is the one this class always had, plus the listing methods a
durable store makes possible. Every method is now async, because a network
store cannot pretend otherwise; every caller was already in an async context.
"""
import uuid

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from .store import Backend, Chat, Turn, now_ms

TITLE_MAX = 60


class NotYours(Exception):
    """A session id that names somebody else's conversation.

    Its own type rather than a None the caller might read as "not found":
    those two mean opposite things here. Nothing is created for an id that is
    not found, and nothing at all happens for one that is not yours.
    """


def title_of(question: str) -> str:
    """A chat's name, which is the first thing that was asked of it.

    Server-side now: the title travels with the conversation, so the phone that
    opens it later shows the same name as the laptop that started it. The rule
    is the one the browser used, moved rather than reinvented.
    """
    text = question.strip()
    if not text:
        return "New chat"
    return f"{text[: TITLE_MAX - 1]}…" if len(text) > TITLE_MAX else text


class SessionStore:
    def __init__(self, backend: Backend, max_messages: int, max_turns: int):
        self._backend = backend
        # How many messages the model is replayed. A turn is two of them, so an
        # odd cap simply rounds down to whole turns — half an exchange is not a
        # useful thing to send.
        self._max_turns_in_context = max(1, max_messages // 2)
        # How many turns a conversation keeps at all. Larger than the context
        # window: the reader scrolls back further than the model is replayed.
        self._max_turns = max(self._max_turns_in_context, max_turns)

    def new_id(self) -> str:
        return uuid.uuid4().hex

    def context(self, chat: Chat | None) -> list[BaseMessage]:
        """The model's context, derived from the stored turns.

        Not a second store — the same turns, rendered. Oldest turns fall off
        the front, which bounds the tokens on every model call and keeps the
        recent exchanges, the ones "as we discussed" is about.

        Takes the conversation rather than its id so a turn loads it once and
        reads everything it needs off that: whose it is, what was said, and
        what is pending.
        """
        if chat is None:
            return []
        messages: list[BaseMessage] = []
        for turn in chat.turns[-self._max_turns_in_context :]:
            messages += [HumanMessage(content=turn.q), AIMessage(content=turn.a)]
        return messages

    async def resume(self, session_id: str, owner: str) -> Chat | None:
        """The conversation a turn continues, checked against who is asking.

        None when there is nothing at that id — a conversation whose thirty
        days are up, or one this caller is about to start — and either is
        theirs to begin.

        `NotYours` when the id names somebody ELSE's conversation, which is the
        case this method exists for. A session id is echoed back to the client
        and now sits in a URL, so it travels: without this check, sending
        somebody else's id would replay their conversation into the model as
        context and append the sender's turn to it. Reading a conversation is
        authorized on the read path; continuing one has to be authorized on
        this one, or the read path's lock is on a door with another way in.
        """
        chat = await self._backend.load(session_id)
        if chat is not None and chat.owner != owner:
            raise NotYours(session_id)
        return chat

    async def history(self, session_id: str) -> list[BaseMessage]:
        """The context at an id, with no owner check — tests and callers that
        have already done one. A turn goes through `resume`."""
        return self.context(await self._backend.load(session_id))

    async def append(
        self,
        session_id: str,
        owner: str,
        question: str,
        answer: str,
        blocks: list[dict],
    ) -> Chat:
        """Remember a finished turn, creating the conversation if it is new.

        The owner is stamped once, when the conversation is created, and never
        moved by a later turn: a chat belongs to whoever started it, and the
        only thing that changes that is signing in (see `reassign`).
        """
        chat = await self._load_or_start(session_id, owner)
        chat.turns.append(Turn(q=question, a=answer, at=now_ms(), blocks=blocks))
        chat.turns = chat.turns[-self._max_turns :]
        if not chat.title:
            chat.title = title_of(question)
        chat.updated = now_ms()
        await self._backend.save(chat)
        return chat

    async def pending(self, session_id: str) -> list[str] | None:
        chat = await self._backend.load(session_id)
        return list(chat.pending) if chat and chat.pending else None

    async def set_pending(self, session_id: str, owner: str, addresses: list[str]) -> None:
        chat = await self._load_or_start(session_id, owner)
        chat.pending = list(addresses)
        chat.updated = now_ms()
        await self._backend.save(chat)

    async def clear_pending(self, session_id: str) -> None:
        chat = await self._backend.load(session_id)
        if chat is None or chat.pending is None:
            return
        chat.pending = None
        await self._backend.save(chat)

    # ── the conversations, as a list somebody can open ──────────────────────

    async def list(self, owner: str, limit: int = 50) -> list[Chat]:
        """That owner's conversations, newest first.

        One call: the index is a ZSET scored by when each chat was last spoken
        to, so ordering is the store's job rather than something done here over
        everything it holds.
        """
        return await self._backend.load_many(owner, limit)

    async def chat(self, session_id: str, owner: str) -> Chat | None:
        """One conversation, if it is this owner's.

        Somebody else's id is None rather than a refusal, and the route turns
        that into a 404. A 403 would confirm the conversation exists, and a
        chat names positions and amounts — the privacy rule is that nothing
        identifying somebody reaches anybody else, which includes the fact of
        them having asked something.
        """
        chat = await self._backend.load(session_id)
        return chat if chat and chat.owner == owner else None

    async def delete(self, session_id: str, owner: str) -> bool:
        chat = await self.chat(session_id, owner)
        if chat is None:
            return False
        await self._backend.delete(chat)
        return True

    async def owns_any(self, owner: str) -> bool:
        return await self._backend.has(owner)

    async def reassign(self, source: str, target: str) -> int:
        """Hand an anonymous visitor's conversations to the account they made.

        The anonymous identity is soft by construction — clearing storage is a
        new person — so this is the one moment a chat changes hands, and it
        only ever goes one way: from the id in the browser to the account that
        browser just signed into.
        """
        if source == target:
            return 0
        return await self._backend.reassign(source, target)

    async def _load_or_start(self, session_id: str, owner: str) -> Chat:
        chat = await self._backend.load(session_id)
        if chat is not None:
            return chat
        stamp = now_ms()
        return Chat(id=session_id, owner=owner, title="", created=stamp, updated=stamp)
