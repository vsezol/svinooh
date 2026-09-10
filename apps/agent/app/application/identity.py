"""Naming the caller: the token asked about, the browser id checked.

The half of identity that does I/O. The Authenticator is the only authority
on a token; what an owner IS lives in app/domain/identity.py.
"""

from ..domain.identity import Owner, clean_anon_id
from .auth import Authenticator


class Identity:
    """Who is asking, as the store keys them."""

    def __init__(self, authenticator: Authenticator) -> None:
        self._authenticator = authenticator

    async def resolve(self, authorization: str | None, anon_id: str | None) -> Owner | None:
        """Name the caller for storage, or None when they have no identity at all.

        An account wins over a browser id: signing in on a shared machine must
        not file the new account's chats under the id the previous person left.

        None rather than a stand-in: a caller who sent neither has nothing that
        outlives one conversation — their conversation is its own owner, which
        SessionStore.open_turn decides once the conversation has an id.
        """
        caller = await self._authenticator.authenticate(authorization)
        anon = clean_anon_id(anon_id)
        if caller and caller.user_id:
            return Owner.for_user(caller.user_id, anon)
        if anon:
            return Owner.for_browser(anon)
        return None
