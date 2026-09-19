import secrets

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"

LENGTH = 6


def new_chat_id() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
