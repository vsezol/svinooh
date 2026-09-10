"""How a conversation is named — short, because the name is a URL.

`/ai/c/3kFm9x` rather than `/ai/c/39f885872a4c43b1bd147347010e68b2`. A uuid was
the obvious first choice and the wrong one for something whose whole job is to
be an address somebody sees, copies and occasionally reads out.

**Why short is safe here, and where it would not be.** This id is not a secret.
Reading a conversation checks that it belongs to the caller (services/sessions
`chat` and `resume`); a guessed id gets a 404 exactly like an invented one, and
the answer is the same either way, so guessing buys nothing. That is the
property that makes six characters reasonable — and it is precisely the
property the anonymous browser id in agent-web does NOT have. That one IS a
bearer token for a browser's conversations, so it stays long and is not this
module's business.

**The alphabet** leaves out the characters people mistake for each other —
`0/O/o` and `1/l/I` — because six characters is short enough that somebody
will eventually read one down a phone. Fifty-six symbols, six of them:

    56^6 = 30,840,979,456

Collisions are handled rather than assumed away: the store is asked before an
id is used (services/sessions `new_id`), so the arithmetic only has to make
retries rare, and at any scale this product will see, it does.

Existing 32-character ids keep working — nothing looks at an id's shape, only
at whether the store has one. They age out on their own thirty days.
"""
import secrets

#: Digits and letters, minus the ones that read as each other.
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz"

#: Long enough to be unlikely, short enough to be a name. See the note above.
LENGTH = 6


def new_chat_id() -> str:
    """A fresh conversation id.

    `secrets` rather than `random`: these are handed out to the public and end
    up in URLs, and a predictable sequence of them would make the existence of
    one conversation say something about the next. Not a secret, but not a
    counter either.
    """
    return "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
