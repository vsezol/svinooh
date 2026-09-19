import time
from dataclasses import dataclass, field

CHAT_TTL_S = 30 * 24 * 60 * 60

TITLE_MAX = 60


def now_ms() -> int:
    return int(time.time() * 1000)


def title_of(question: str) -> str:
    text = question.strip()
    if not text:
        return "New chat"
    return f"{text[: TITLE_MAX - 1]}…" if len(text) > TITLE_MAX else text


@dataclass
class Turn:
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
    id: str
    owner: str
    title: str
    created: int
    updated: int
    turns: list[Turn] = field(default_factory=list)
    pending: list[str] | None = None
    portfolio: str | None = None

    def add(self, question: str, answer: str, blocks: list[dict], keep: int) -> None:
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
            portfolio=str(raw["portfolio"]) if raw.get("portfolio") else None,
        )
