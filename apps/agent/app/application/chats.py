"""The conversations, read rather than continued.

A conversation is a server object: it has an address and an owner, so
reading one is authorized to whoever it belongs to and nobody else.
"""

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
        """This caller's conversations, newest first.

        Empty for a caller with no identity, which is the honest answer rather
        than a refusal: there is no such thing as somebody else's list to leak
        here, because the key a listing is built from is the caller's own.
        """
        owner = await self._owner(caller)
        return await self._sessions.list(owner.key, self._limit) if owner else []

    async def one(self, caller: Caller, chat_id: str) -> Chat:
        """One conversation, if it belongs to whoever is asking."""
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
        """Who is asking, for a read.

        The re-key runs here as well as on a turn, and it has to: somebody
        signs in from the card under their first answer and the rail asks for
        their list immediately, before there is a next question to carry the
        move. Without it that list comes back empty at exactly the moment they
        acted to keep the conversation.
        """
        owner = await self._identity.resolve(caller.authorization, caller.anon_id)
        await self._sessions.claim(owner)
        return owner
