"""Who is asking — the value, and the rule for reading it off a header.

Pure: naming a caller from a token is I/O and lives in app/services/identity.py.
What is here is what an owner IS, and everything downstream keys on one string:

    user:<id>    somebody the host API named from their token
    anon:<id>    a browser holding a client-generated id (the header below)
    sess:<id>    neither — the conversation is its own owner

The anonymous identity is soft by construction. Clearing storage or opening a
private window is a new person, so this is what history hangs on, never what a
limit is enforced by — a limit wants something harder behind it, which is why
the free allowance counts against this for the copy and against an account for
the enforcement.

--- Coordination note -------------------------------------------------------
The browser half of this — generating the id and holding it — is step 3 part 1
of apps/agent-web/ROADMAP.md, which belongs to a separate branch. This is the
server seam part 2 could not be built without, kept small and in a file of its
own so part 1 can take it over. If part 1 lands a different header or id
format, this module and services/identity.py are the only things that change.
-----------------------------------------------------------------------------
"""
import re
from dataclasses import dataclass

#: What the browser sends its id on. Named, not guessed at, in one place.
ANON_HEADER = "X-Svinooh-Anon-Id"

#: An id the browser made up arrives here and becomes part of a storage key, so
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

    @property
    def anonymous_key(self) -> str | None:
        """Where this caller's conversations were filed before they signed in."""
        return f"anon:{self.anon_id}" if self.anon_id else None

    @staticmethod
    def for_user(user_id: str, anon_id: str | None = None) -> "Owner":
        return Owner(key=f"user:{user_id}", user_id=user_id, anon_id=anon_id)

    @staticmethod
    def for_browser(anon_id: str) -> "Owner":
        return Owner(key=f"anon:{anon_id}", anon_id=anon_id)

    @staticmethod
    def for_session(session_id: str) -> "Owner":
        """The fallback: a conversation that is its own owner.

        A caller that sends neither a token nor a browser id — an older widget,
        since the two deploy separately — still gets a conversation that
        continues across turns. It simply appears in nobody's list, because
        there is nothing to list it under. That is exactly what this service
        did before it had a store, so a version skew degrades to the old world
        rather than to a broken one.
        """
        return Owner(key=f"sess:{session_id}")

    @property
    def listable(self) -> bool:
        """Whether this caller is somebody a listing can be built for."""
        return not self.key.startswith("sess:")


def clean_anon_id(raw: str | None) -> str | None:
    """The header's value if it could be an id, None if it could not."""
    value = (raw or "").strip()
    return value if _ANON_ID.match(value) else None
