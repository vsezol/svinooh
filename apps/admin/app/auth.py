"""One operator, one password, a signed session cookie.

Deliberately not a user table. This panel can change how hard the whole system
pushes and reads every balance in the database, so the smallest thing that can
open it is the right one — there is nobody to invite, no roles to get wrong, and
no reset flow to be phished through.

The password is stored hashed. `ADMIN_PASSWORD` is accepted too, because a
plaintext value in a secret store is what somebody will reach for at 2am and a
panel nobody can get into is worse than one whose secret sits where DATABASE_URL
already does — but it says so in the log every time it starts.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets

from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request

log = logging.getLogger("admin.auth")

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1


def hash_password(password: str, salt: bytes | None = None) -> str:
    """`scrypt$<salt>$<key>` — stdlib only, and slow enough to matter."""
    salt = salt or secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${salt.hex()}${key.hex()}"


def verify(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, key_hex = stored.split("$", 2)
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    candidate = hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt_hex), n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32
    )
    return secrets.compare_digest(candidate.hex(), key_hex)


class AdminAuth(AuthenticationBackend):
    def __init__(self, secret_key: str) -> None:
        super().__init__(secret_key=secret_key)
        self.user = os.environ.get("ADMIN_USER", "admin")
        self.password_hash = os.environ.get("ADMIN_PASSWORD_HASH", "")
        self.password_plain = os.environ.get("ADMIN_PASSWORD", "")
        if not self.password_hash and self.password_plain:
            log.warning(
                "ADMIN_PASSWORD is set in plaintext. Generate a hash with "
                "`python -m app.hash` and set ADMIN_PASSWORD_HASH instead."
            )

    def _correct(self, user: str, password: str) -> bool:
        # compare_digest on the name too: a wrong name and a wrong password
        # should take the same time to be wrong
        if not secrets.compare_digest(user, self.user):
            return False
        if self.password_hash:
            return verify(password, self.password_hash)
        if self.password_plain:
            return secrets.compare_digest(password, self.password_plain)
        return False

    async def login(self, request: Request) -> bool:
        form = await request.form()
        ok = self._correct(str(form.get("username", "")), str(form.get("password", "")))
        if ok:
            request.session.update({"user": self.user})
        else:
            log.warning("failed sign-in from %s", request.client.host if request.client else "?")
        return ok

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        return request.session.get("user") == self.user


def configured() -> bool:
    """Whether anybody can sign in at all. Unset means the panel refuses everyone."""
    return bool(os.environ.get("ADMIN_PASSWORD_HASH") or os.environ.get("ADMIN_PASSWORD"))
