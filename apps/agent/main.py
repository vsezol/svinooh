"""
AI agent — минимальный микросервис-прокси к LLM.

Пока это чистый вопрос-ответ: POST /chat {message} -> {reply}. Внутренний сервис
за api-gateway (наружу не торчит; api форвардит /ai/* сюда, как /auth/* в auth).
Фронт зовёт его через шов `Answerer` (web/src/lib/agent-service.ts) и оборачивает
ответ в текстовый блок. Дальше сюда прирастёт контекст портфеля, инструменты и
граф — по одному слою, а контракт наружу не меняется.
"""
import os

from fastapi import FastAPI, HTTPException
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

MODEL = os.getenv("AGENT_MODEL", "claude-opus-5")  # дёшево/быстро: "claude-haiku-4-5"
SYSTEM = os.getenv(
    "AGENT_SYSTEM",
    "Ты ассистент внутри svinooh — трекера DeFi-портфелей. Отвечай кратко и по"
    " делу. Доступа к цифрам конкретного портфеля у тебя пока нет — это"
    " следующий шаг; отвечай на общие вопросы о DeFi и приложении.",
)

app = FastAPI(title="svinooh-agent")

# Ленивая инициализация: сервис поднимается и отвечает на /health даже без ключа,
# а ANTHROPIC_API_KEY нужен только на первый /chat. Так деплой не крашится в цикле,
# если ключ ещё не проставили. ChatAnthropic берёт ключ из окружения сам.
_llm: ChatAnthropic | None = None


def get_llm() -> ChatAnthropic:
    global _llm
    if _llm is None:
        _llm = ChatAnthropic(model=MODEL, max_tokens=1024, timeout=60)
    return _llm


def _text(reply) -> str:
    # Ответ приходит строкой ИЛИ списком блоков (модель умеет «думать» перед
    # ответом). Достаём только текст, чтобы наружу шёл чистый ответ.
    if isinstance(reply.content, str):
        return reply.content
    return "".join(
        block.get("text", "")
        for block in reply.content
        if isinstance(block, dict) and block.get("type") == "text"
    )


class ChatIn(BaseModel):
    message: str


class ChatOut(BaseModel):
    reply: str


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/chat", response_model=ChatOut)
async def chat(body: ChatIn) -> ChatOut:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")
    # Один вызов модели: system + вопрос -> ответ. Никакой логики — чистая прокси.
    reply = await get_llm().ainvoke(
        [SystemMessage(content=SYSTEM), HumanMessage(content=text)]
    )
    return ChatOut(reply=_text(reply))
