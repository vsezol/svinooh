"""A conversation, and the rules that hold whatever it is kept in.

Pure: no Redis, no HTTP, no framework, no model client. What a conversation IS
lives here; where it is kept is app/adapters, and what is done with it is
app/services. The layer is worth having precisely because these types mean the
same thing coming out of Redis, out of a dict in a test, or out of whatever
replaces Redis later.

**One representation.** A conversation is its turns. The context replayed into
the model is derived from them (app/services/sessions.py) and so is the
transcript the reader sees — two projections of one record, never two records.
That split, kept as two stores, is the bug this whole step existed to remove.
"""

import time
from dataclasses import dataclass, field

#: How long a conversation is kept, counted from its last turn.
#:
#: Here rather than in config.py because it is not a knob: it is the promise
#: the product makes about how long a chat survives, and changing it is a
#: decision rather than a deploy. A chat disappearing when this runs out is the
#: intended behaviour, not a limitation to work around.
CHAT_TTL_S = 30 * 24 * 60 * 60

#: The longest a conversation's name may be before it is cut.
TITLE_MAX = 60


def now_ms() -> int:
    return int(time.time() * 1000)


def title_of(question: str) -> str:
    """A chat's name, which is the first thing that was asked of it.

    A rule rather than a formatting helper, which is why it is here: the title
    travels with the conversation, so the phone that opens it later shows the
    same name as the laptop that started it.
    """
    text = question.strip()
    if not text:
        return "New chat"
    return f"{text[: TITLE_MAX - 1]}…" if len(text) > TITLE_MAX else text


@dataclass
class Turn:
    """One exchange — a question and its answer — not one message.

    `a` is the answer as text: what the model is replayed on a later turn.
    `blocks` is the same answer as the reader saw it. One record rather than
    two stores, because rebuilding blocks from the text on read would be a
    layer guessing what to draw. Today blocks is always a single text block;
    the tool-drawn widgets of roadmap steps 1 and 2 land in it without this
    file changing.
    """

    q: str
    a: str
    at: int
    blocks: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"q": self.q, "a": self.a, "at": self.at, "blocks": self.blocks}

    @staticmethod
    def from_dict(raw: dict) -> "Turn":
        blocks = raw.get("blocks")
        return Turn(
            q=str(raw.get("q") or ""),
            a=str(raw.get("a") or ""),
            at=int(raw.get("at") or 0),
            blocks=blocks if isinstance(blocks, list) else [],
        )


@dataclass
class Chat:
    """A conversation, whole. The only representation of one there is."""

    id: str
    owner: str
    title: str
    created: int
    updated: int
    turns: list[Turn] = field(default_factory=list)
    # An action proposed but not yet confirmed — today the wallet addresses of
    # a portfolio-creation proposal. Living with the conversation is what makes
    # the confirmation a SEPARATE turn: the write physically cannot happen in
    # the request that proposed it. It used to live in RAM, which meant a
    # restart between the proposal and the yes silently dropped the proposal.
    pending: list[str] | None = None
    # The portfolio this conversation brought into being, for a visitor with no
    # account. A signed-in caller is asked "what do you own" and the host
    # answers; nobody can ask that about somebody who has no name, so the one
    # place the answer can live is the conversation that did it. Without this a
    # visitor is onboarded again on the very next question — offered a
    # portfolio they already have.
    portfolio: str | None = None

    def add(self, question: str, answer: str, blocks: list[dict], keep: int) -> None:
        """Record a finished turn, naming the conversation if it is the first.

        A method rather than something done to the dataclass from outside: the
        cap and the title are rules about what a conversation is, so they hold
        no matter which adapter is about to write it down.
        """
        self.turns.append(Turn(q=question, a=answer, at=now_ms(), blocks=blocks))
        self.turns = self.turns[-keep:]
        if not self.title:
            self.title = title_of(question)
        self.updated = now_ms()

    @staticmethod
    def start(chat_id: str, owner: str) -> "Chat":
        stamp = now_ms()
        return Chat(id=chat_id, owner=owner, title="", created=stamp, updated=stamp)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "owner": self.owner,
            "title": self.title,
            "created": self.created,
            "updated": self.updated,
            "turns": [turn.as_dict() for turn in self.turns],
            "pending": self.pending,
            "portfolio": self.portfolio,
        }

    @staticmethod
    def from_dict(raw: dict) -> "Chat | None":
        """Rebuild a chat, or None for anything that is not one.

        A stored value that cannot be read is treated as absent rather than as
        an error: the store is the only thing that writes there, so a shape it
        does not recognise is either a half-finished migration or somebody
        else's key, and neither is worth failing a chat turn over.
        """
        if not isinstance(raw, dict) or not raw.get("id") or not raw.get("owner"):
            return None
        turns = raw.get("turns")
        pending = raw.get("pending")
        return Chat(
            id=str(raw["id"]),
            owner=str(raw["owner"]),
            title=str(raw.get("title") or ""),
            created=int(raw.get("created") or 0),
            updated=int(raw.get("updated") or 0),
            turns=[Turn.from_dict(t) for t in turns if isinstance(t, dict)]
            if isinstance(turns, list)
            else [],
            pending=[str(a) for a in pending] if isinstance(pending, list) and pending else None,
            # Absent in every chat stored before this field existed, which is
            # why it is read like all the rest: missing is None, not an error.
            portfolio=str(raw["portfolio"]) if raw.get("portfolio") else None,
        )
