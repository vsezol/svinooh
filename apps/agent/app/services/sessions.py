"""Conversation memory — and now the conversations themselves.

The model API is stateless: "context" in every production system is the server
keeping the conversation and replaying it into each call. This service is that
mechanism — and, since the store became durable, it is also the product feature
the old note here promised for later: past conversations, kept in the agent's
own store, never the portfolio's database, so the service's independence holds.

The two turned out to be one thing, which is the whole point of this class.
A conversation is stored **once**, as its turns. What the model is replayed is
a projection of those turns (`context`, the last N rendered as messages) and
what the reader sees is another (`chat`, the turns with their blocks). Keeping
a message list beside the transcript would be two copies of one conversation —
the split that made a restart lose the thread while the transcript stayed on
screen.

It depends on ports.ConversationStore and never on an adapter, which is what
lets Redis be swapped for a database or an HTTP service without a line moving
in this file.
"""

import logging

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from ..domain.conversation import Chat
from ..domain.identity import Owner
from ..domain.ids import new_chat_id
from ..ports import ConversationStore

logger = logging.getLogger("svinooh-ai")

#: How many times a colliding id is retried before one is used regardless.
_ID_ATTEMPTS = 5


class SessionStore:
    def __init__(self, store: ConversationStore, max_messages: int, max_turns: int):
        self._store = store
        # How many messages the model is replayed. A turn is two of them, so an
        # odd cap simply rounds down to whole turns — half an exchange is not a
        # useful thing to send.
        self._max_turns_in_context = max(1, max_messages // 2)
        # How many turns a conversation keeps at all. Larger than the context
        # window: the reader scrolls back further than the model is replayed.
        self._max_turns = max(self._max_turns_in_context, max_turns)

    async def new_id(self) -> str:
        """An id nothing is stored under yet.

        Short ids are short enough to collide eventually, so the store is asked
        rather than trusted to luck. A handful of tries is generous: at
        56^6 the first one is free until this product has billions of
        conversations, and the loop is here so that "eventually" never becomes
        somebody's conversation being overwritten by a stranger's.

        The last attempt is returned unchecked, because failing to name a chat
        is a worse answer than a collision this improbable.
        """
        for _ in range(_ID_ATTEMPTS - 1):
            candidate = new_chat_id()
            if await self._store.load(candidate) is None:
                return candidate
            logger.warning("chat id collision on %s — trying another", candidate)
        return new_chat_id()

    async def open_turn(
        self, session_id: str | None, identity: Owner | None
    ) -> tuple[str, Chat | None, Owner]:
        """Which conversation this turn runs in, under which id, for whom.

        A caller's own live conversation is continued. Anything else — no id,
        an id whose thirty days are up, an id belonging to somebody else —
        quietly becomes a new conversation under a freshly minted id, and the
        client learns which from the id that comes back.

        Refusing an unknown id instead would be an existence oracle, and short
        ids are guessable enough for that to matter: probing would separate
        "taken" from "free", let somebody squat the free ones, and say that a
        conversation exists at an address. Minting makes every probe look the
        same, and it is the honest outcome anyway — a conversation whose id no
        longer resolves is gone, and the new one is not at the old address.

        `identity` is None for a caller with neither a token nor a browser id.
        Their conversation is its own owner, so the owner cannot be settled
        until the id is — which is the whole reason this returns all three.
        """
        if identity is not None:
            if session_id:
                chat = await self._store.load(session_id)
                if chat is not None and chat.owner == identity.key:
                    return session_id, chat, identity
            return await self.new_id(), None, identity

        # No identity: the conversation owns itself, and "is it mine" means
        # "was it started this same way, under this same id".
        if session_id:
            owner = Owner.for_session(session_id)
            chat = await self._store.load(session_id)
            if chat is not None and chat.owner == owner.key:
                return session_id, chat, owner
        fresh = await self.new_id()
        return fresh, None, Owner.for_session(fresh)

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

    async def history(self, session_id: str) -> list[BaseMessage]:
        """The context at an id, with no owner check — tests and callers that
        have already done one. A turn goes through `start_or_resume`."""
        return self.context(await self._store.load(session_id))

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
        chat.add(question, answer, blocks, self._max_turns)
        await self._store.save(chat)
        return chat

    async def pending(self, session_id: str) -> list[str] | None:
        chat = await self._store.load(session_id)
        return list(chat.pending) if chat and chat.pending else None

    async def set_pending(self, session_id: str, owner: str, addresses: list[str]) -> None:
        chat = await self._load_or_start(session_id, owner)
        chat.pending = list(addresses)
        await self._store.save(chat)

    async def set_portfolio(self, session_id: str, owner: str, slug: str) -> None:
        """Remember the portfolio this conversation created (see Chat.portfolio)."""
        chat = await self._load_or_start(session_id, owner)
        chat.portfolio = slug
        await self._store.save(chat)

    async def clear_pending(self, session_id: str) -> None:
        chat = await self._store.load(session_id)
        if chat is None or chat.pending is None:
            return
        chat.pending = None
        await self._store.save(chat)

    # ── the conversations, as a list somebody can open ──────────────────────

    async def list(self, owner: str, limit: int = 50) -> list[Chat]:
        """That owner's conversations, newest first."""
        return await self._store.for_owner(owner, limit)

    async def chat(self, session_id: str, owner: str) -> Chat | None:
        """One conversation, if it is this owner's.

        Somebody else's id is None rather than a refusal, and the route turns
        that into a 404. A 403 would confirm the conversation exists, and a
        chat names positions and amounts — the privacy rule is that nothing
        identifying somebody reaches anybody else, which includes the fact of
        them having asked something.
        """
        chat = await self._store.load(session_id)
        return chat if chat and chat.owner == owner else None

    async def delete(self, session_id: str, owner: str) -> bool:
        chat = await self.chat(session_id, owner)
        if chat is None:
            return False
        await self._store.delete(chat)
        return True

    async def owns_any(self, owner: str) -> bool:
        return await self._store.has_any(owner)

    async def reassign(self, source: str, target: str) -> int:
        """Hand an anonymous visitor's conversations to the account they made.

        The anonymous identity is soft by construction — clearing storage is a
        new person — so this is the one moment a chat changes hands, and it
        only ever goes one way: from the id in the browser to the account that
        browser just signed into.
        """
        if source == target:
            return 0
        return await self._store.reassign(source, target)

    async def _load_or_start(self, session_id: str, owner: str) -> Chat:
        chat = await self._store.load(session_id)
        return chat if chat is not None else Chat.start(session_id, owner)
