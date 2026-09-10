"""Naming the caller: the token asked about, the browser id checked.

The half of identity that does I/O. `auth.authenticate` is the only authority
on a token — the host API — and everything else about what an owner is lives
in app/domain/identity.py, which imports nothing.
"""

from ..domain.identity import Owner, clean_anon_id
from .auth import authenticate


async def resolve_owner(authorization: str | None, anon_id: str | None) -> Owner | None:
    """Name the caller for storage, or None when they have no identity at all.

    An account wins over a browser id: signing in on a shared machine must not
    file the new account's chats under the id the previous person left behind.

    None rather than a stand-in, because a caller who sent neither has nothing
    that outlives one conversation — their conversation is its own owner, and
    that cannot be decided here, before the conversation has an id. See
    SessionStore.open_turn, which is where it is decided.
    """
    caller = await authenticate(authorization)
    anon = clean_anon_id(anon_id)
    if caller and caller.user_id:
        return Owner.for_user(caller.user_id, anon)
    if anon:
        return Owner.for_browser(anon)
    return None
