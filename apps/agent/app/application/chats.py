from ..domain.conversation import Chat
from ..domain.errors import NoSuchConversationError
from ..domain.identity import Caller, Owner
from .identity import Identity
from .sessions import SessionStore


class Chats:
    def __init__(self, sessions: SessionStore, identity: Identity, limit: int) -> None:
        self._sessions = sessions
        self._identity = identity
        self._limit = limit

    async def of(self, caller: Caller) -> list[Chat]:
        owner = await self._owner(caller)
        return await self._sessions.list(owner.key, self._limit) if owner else []

    async def one(self, caller: Caller, chat_id: str) -> Chat:
        owner = await self._owner(caller)
        chat = await self._sessions.chat(chat_id, owner.key) if owner else None
        if chat is None:
            raise NoSuchConversationError
        return chat

    async def forget(self, caller: Caller, chat_id: str) -> None:
        owner = await self._owner(caller)
        if owner is None or not await self._sessions.delete(chat_id, owner.key):
            raise NoSuchConversationError

    async def _owner(self, caller: Caller) -> Owner | None:
        owner = await self._identity.resolve(caller.authorization, caller.anon_id)
        await self._sessions.claim(owner)
        return owner
