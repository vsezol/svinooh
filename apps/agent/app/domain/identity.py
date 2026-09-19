import re
from dataclasses import dataclass

ANON_HEADER = "X-Svinooh-Anon-Id"

_ANON_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@dataclass(frozen=True)
class Caller:
    authorization: str | None = None
    anon_id: str | None = None


@dataclass(frozen=True)
class Owner:
    key: str
    user_id: str | None = None
    anon_id: str | None = None

    @property
    def signed_in(self) -> bool:
        return self.user_id is not None

    @property
    def anonymous_key(self) -> str | None:
        return f"anon:{self.anon_id}" if self.anon_id else None

    @staticmethod
    def for_user(user_id: str, anon_id: str | None = None) -> "Owner":
        return Owner(key=f"user:{user_id}", user_id=user_id, anon_id=anon_id)

    @staticmethod
    def for_browser(anon_id: str) -> "Owner":
        return Owner(key=f"anon:{anon_id}", anon_id=anon_id)

    @staticmethod
    def for_session(session_id: str) -> "Owner":
        return Owner(key=f"sess:{session_id}")


def clean_anon_id(raw: str | None) -> str | None:
    value = (raw or "").strip()
    return value if _ANON_ID.match(value) else None
