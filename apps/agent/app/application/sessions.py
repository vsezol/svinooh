import logging

from ..domain.conversation import Chat, Turn
from ..domain.identity import Owner
from ..domain.ids import new_chat_id
from ..ports import ConversationStore

logger = logging.getLogger("svinooh-ai")

_ID_ATTEMPTS = 5


class SessionStore:
    def __init__(self, store: ConversationStore, max_messages: int, max_turns: int):
        self._store = store
        self._max_turns_in_context = max(1, max_messages // 2)
        self._max_turns = max(self._max_turns_in_context, max_turns)

    async def new_id(self) -> str:
        for _ in range(_ID_ATTEMPTS - 1):
            candidate = new_chat_id()
            if await self._store.load(candidate) is None:
                return candidate
            logger.warning("chat id collision on %s — trying another", candidate)
        return new_chat_id()

    async def open_turn(
        self, session_id: str | None, identity: Owner | None
    ) -> tuple[str, Chat | None, Owner]:
        if identity is not None:
            if session_id:
                chat = await self._store.load(session_id)
                if chat is not None and chat.owner == identity.key:
                    return session_id, chat, identity
            return await self.new_id(), None, identity

        if session_id:
            owner = Owner.for_session(session_id)
            chat = await self._store.load(session_id)
            if chat is not None and chat.owner == owner.key:
                return session_id, chat, owner
        fresh = await self.new_id()
        return fresh, None, Owner.for_session(fresh)

    def context(self, chat: Chat | None) -> tuple[Turn, ...]:
        if chat is None:
            return ()
        return tuple(chat.turns[-self._max_turns_in_context :])

    async def history(self, session_id: str) -> tuple[Turn, ...]:
        return self.context(await self._store.load(session_id))

    async def append(
        self,
        session_id: str,
        owner: str,
        question: str,
        answer: str,
        blocks: list[dict],
    ) -> Chat:
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
        chat = await self._load_or_start(session_id, owner)
        chat.portfolio = slug
        await self._store.save(chat)

    async def clear_pending(self, session_id: str) -> None:
        chat = await self._store.load(session_id)
        if chat is None or chat.pending is None:
            return
        chat.pending = None
        await self._store.save(chat)

    async def list(self, owner: str, limit: int = 50) -> list[Chat]:
        return await self._store.for_owner(owner, limit)

    async def chat(self, session_id: str, owner: str) -> Chat | None:
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

    async def claim(self, owner: Owner | None) -> None:
        if owner is None or not owner.signed_in:
            return
        source = owner.anonymous_key
        if source is not None and await self.owns_any(source):
            await self.reassign(source, owner.key)

    async def reassign(self, source: str, target: str) -> int:
        if source == target:
            return 0
        return await self._store.reassign(source, target)

    async def _load_or_start(self, session_id: str, owner: str) -> Chat:
        chat = await self._store.load(session_id)
        return chat if chat is not None else Chat.start(session_id, owner)
