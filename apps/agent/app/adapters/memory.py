import time

from limits.aio.storage import MemoryStorage

from ..domain.conversation import CHAT_TTL_S, Chat
from ..panel import NOTHING_DECIDED, PanelValues


class MemoryConversationStore:
    def __init__(self) -> None:
        self._chats: dict[str, tuple[float, Chat]] = {}
        self._index: dict[str, tuple[float, dict[str, int]]] = {}

    def _live_chat(self, chat_id: str) -> Chat | None:
        found = self._chats.get(chat_id)
        if not found:
            return None
        if found[0] < time.time():
            del self._chats[chat_id]
            return None
        return found[1]

    def _live_index(self, owner: str) -> dict[str, int] | None:
        found = self._index.get(owner)
        if not found:
            return None
        if found[0] < time.time():
            del self._index[owner]
            return None
        return found[1]

    async def load(self, chat_id: str) -> Chat | None:
        return self._live_chat(chat_id)

    async def save(self, chat: Chat) -> None:
        expires = time.time() + CHAT_TTL_S
        self._chats[chat.id] = (expires, chat)
        entries = self._live_index(chat.owner) or {}
        entries[chat.id] = chat.updated
        self._index[chat.owner] = (expires, entries)

    async def for_owner(self, owner: str, limit: int) -> list[Chat]:
        entries = self._live_index(owner)
        if not entries:
            return []
        newest = sorted(entries, key=lambda cid: (entries[cid], cid), reverse=True)[:limit]
        chats: list[Chat] = []
        missing: list[str] = []
        for chat_id in newest:
            chat = self._live_chat(chat_id)
            if chat is None:
                missing.append(chat_id)
            else:
                chats.append(chat)
        for chat_id in missing:
            entries.pop(chat_id, None)
        return chats

    async def delete(self, chat: Chat) -> None:
        self._chats.pop(chat.id, None)
        entries = self._live_index(chat.owner)
        if entries:
            entries.pop(chat.id, None)

    async def has_any(self, owner: str) -> bool:
        return bool(self._live_index(owner))

    async def reassign(self, source: str, target: str) -> int:
        entries = self._live_index(source)
        if not entries:
            return 0
        moved = 0
        for chat_id in list(entries):
            chat = self._live_chat(chat_id)
            if chat is None:
                continue
            chat.owner = target
            await self.save(chat)
            moved += 1
        self._index.pop(source, None)
        return moved


def rate_limit_storage() -> MemoryStorage:
    return MemoryStorage()


class StaticPanel:
    def __init__(self, values: PanelValues = NOTHING_DECIDED) -> None:
        self._values = values

    def current(self) -> PanelValues:
        return self._values

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None


class MemoryStrategies:
    def __init__(self) -> None:
        self._running: set[str] = set()

    async def running(self, portfolio: str) -> bool:
        return portfolio in self._running

    async def run(self, portfolio: str, on: bool) -> None:
        if on:
            self._running.add(portfolio)
        else:
            self._running.discard(portfolio)
