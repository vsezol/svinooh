"""Print a password hash to paste into ADMIN_PASSWORD_HASH.

    python -m app.hash

Reads the password from a prompt rather than from the command line, so it does
not end up in a shell history.
"""

from getpass import getpass

from app.auth import hash_password

if __name__ == "__main__":
    first = getpass("Password: ")
    if first != getpass("Again: "):
        raise SystemExit("They do not match.")
    if len(first) < 12:
        raise SystemExit("Use at least 12 characters — this panel opens the whole database.")
    print(hash_password(first))
