"""The HTTP surface: /health for the platform, /chat for everyone else."""
from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage

from .config import settings
from .llm import extract_text, get_model
from .schemas import ChatRequest, ChatResponse
from .sessions import SessionStore

router = APIRouter()
sessions = SessionStore(settings.history_max_messages, settings.history_ttl_s)


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest) -> ChatResponse:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")

    # One call per turn, but not one turn of context: the session's history
    # rides along, which is what makes "as we discussed" work across requests.
    session_id = body.session_id or sessions.new_id()
    messages = [
        SystemMessage(content=settings.system_prompt),
        *sessions.history(session_id),
        HumanMessage(content=text),
    ]
    reply = await get_model().ainvoke(messages)
    answer = extract_text(reply)

    # Remembered only after the model answered: a failed call leaves the
    # session exactly as it was, instead of a question with no answer in it.
    sessions.append(session_id, text, answer)
    return ChatResponse(reply=answer, session_id=session_id)
