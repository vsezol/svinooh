"""The HTTP surface: /health for the platform, /chat for everyone else.

Thin on purpose since R2: this layer validates the request, hands a state to
the graph, and stores the finished turn. What happens between — routing,
context, the model — is the graph's business (app/graph.py), which is why new
branches land there without this file changing again.
"""
from fastapi import APIRouter, Header, HTTPException

from .config import settings
from .graph import agent_graph
from .schemas import ChatRequest, ChatResponse
from .sessions import SessionStore

router = APIRouter()
sessions = SessionStore(settings.history_max_messages, settings.history_ttl_s)


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    authorization: str | None = Header(default=None),
) -> ChatResponse:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")

    # The session's history rides into the graph, which is what makes "as we
    # discussed" work across requests; the graph decides everything else.
    session_id = body.session_id or sessions.new_id()
    state = await agent_graph().ainvoke(
        {
            "question": text,
            "history": sessions.history(session_id),
            "portfolio": body.portfolio,
            "authorization": authorization,
        }
    )
    answer = state["answer"]

    # Remembered only after the graph answered: a failed turn leaves the
    # session exactly as it was, instead of a question with no answer in it.
    sessions.append(session_id, text, answer)
    return ChatResponse(reply=answer, session_id=session_id)
