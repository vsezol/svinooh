"""Who is asking — before the service knows their name.

`auth.py` answers "whose token is this", which is the only authority on an
account. This module answers the question underneath it: **what do I key this
person's conversations on**, including when there is no account at all.

The answer is one string, and everything downstream keys on that string alone:

    user:<id>    somebody the host API named from their token
    anon:<id>    a browser holding a client-generated id (the header below)
    sess:<id>    neither — the conversation is its own owner; see the fallback

The anonymous identity is soft by construction. Clearing storage or opening a
private window is a new person, so this is what history hangs on, never what a
limit is enforced by — a limit wants something harder behind it, which is why
the free allowance counts against this for the copy and against an account for
the enforcement.

--- Coordination note -------------------------------------------------------
The browser half of this — generating the id and holding it — is step 3 part 1
of apps/agent-web/ROADMAP.md, which belongs to a separate branch. This module
is the server seam that part 2 could not be built without, kept deliberately
small and in its own file so part 1 can take it over without a merge fight in
auth.py. If part 1 lands a different header or id format, this is the one place
that changes.
-----------------------------------------------------------------------------
"""
import re
from dataclasses import dataclass

from .auth import authenticate

#: What the browser sends its id on. Named, not guessed at, in one place.
ANON_HEADER = "X-Svinooh-Anon-Id"

#: An id the browser made up arrives here and becomes part of a Redis key, so
#: it is checked before it is trusted with that. Deliberately a shape rather
#: than an exact format — uuid hex, nanoid and base64url all pass — because the
#: format is part 1's to choose and this only has to keep a key safe.
_ANON_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@dataclass(frozen=True)
class Owner:
    """The caller, as the store keys them."""

    #: The only thing anything downstream uses.
    key: str
    #: Set when a token named them — what a re-key moves conversations TO.
    user_id: str | None = None
    #: Set when a browser sent one — what a re-key moves conversations FROM.
    anon_id: str | None = None

    @property
    def signed_in(self) -> bool:
        return self.user_id is not None


def clean_anon_id(raw: str | None) -> str | None:
    """The header's value if it could be an id, None if it could not."""
    value = (raw or "").strip()
    return value if _ANON_ID.match(value) else None


async def resolve_owner(
    authorization: str | None,
    anon_id: str | None,
    session_id: str,
) -> Owner:
    """Name the caller for storage.

    An account wins over a browser id: signing in on a shared machine must not
    file the new account's chats under the id the previous person left behind.

    `session_id` is the fallback and only the fallback. A caller that sends
    neither a token nor an id — an older widget, since the two deploy
    separately — still gets a conversation that continues across turns, keyed
    on the conversation's own id. It simply appears in nobody's list, because
    there is nothing to list it under. That is exactly the behaviour this
    service had before it had a store, so a version skew degrades to the old
    world rather than to a broken one.
    """
    caller = await authenticate(authorization)
    anon = clean_anon_id(anon_id)
    if caller and caller.user_id:
        return Owner(key=f"user:{caller.user_id}", user_id=caller.user_id, anon_id=anon)
    if anon:
        return Owner(key=f"anon:{anon}", anon_id=anon)
    return Owner(key=f"sess:{session_id}")
