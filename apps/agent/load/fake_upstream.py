"""The model and the host API, faked, so a load test measures us.

Pointing the service at the real OpenRouter would measure OpenRouter: its
queueing, its rate limits, its weather. What we want to know is what this
service does with a hundred people asking at once — how long a turn waits in
our own semaphore, whether our connection pool holds, what our p95 is when
the upstream is boringly constant.

So this answers both upstreams on one port, in the shape the real ones use:

    /v1/chat/completions   the OpenAI wire, tool calls and streaming included
    /api/auth/me           the host's identity oracle
    /api/portfolios/{ref}  a portfolio big enough to be worth parsing
    /api/portfolios/{ref}/history
    /api/agent/config      the admin panel

Every delay is a knob, so the same run can be repeated with a slower model
and the difference read off the numbers rather than argued about.

    uv run python load/fake_upstream.py            # port 9099
    FAKE_MODEL_DELAY_MS=800 uv run python load/fake_upstream.py
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

#: How long the fake model takes to answer. The real one takes seconds; the
#: point of a small number here is to find OUR ceiling rather than to wait.
MODEL_DELAY_MS = int(os.getenv("FAKE_MODEL_DELAY_MS", "300"))
#: How long the fake host API takes. A portfolio fetch rides inside a turn.
API_DELAY_MS = int(os.getenv("FAKE_API_DELAY_MS", "40"))
#: How many positions the portfolio holds — the payload the mapper parses and
#: the context block renders on every grounded turn.
POSITIONS = int(os.getenv("FAKE_POSITIONS", "60"))

ANSWER = (
    "Impermanent loss is the gap between holding two tokens and providing "
    "them as liquidity, and it only becomes permanent when you withdraw."
)

USAGE = {"prompt_tokens": 800, "completion_tokens": 40, "total_tokens": 840}

app = FastAPI(title="fake-upstream")


async def _wait(ms: int) -> None:
    if ms:
        await asyncio.sleep(ms / 1000)


def _portfolio(ref: str) -> dict[str, Any]:
    positions = [
        {
            "id": f"pos-{i}",
            "symbol": f"TKN{i}",
            "name": None if i % 3 else f"Position {i}",
            "note": None,
            "network": ("eth", "base", "arb", "bsc")[i % 4],
            "amount": 1000.0 + i,
            "priceUsd": 1.5 + i / 100,
            "valueUsd": round(10_000 - i * 37.5, 2),
            "platform": "wallet" if i % 2 else ("aave3", "uniswap3")[i % 2 == 0],
            "category": "token" if i % 2 else "defi",
            "apy": None if i % 2 else 0.042,
            "healthRate": None if i % 5 else 2.1,
            "borrowApy": None,
            "range": None,
            "band": None if i % 7 else {"pair": "ETH/USDC", "feePct": 0.05},
            "tokens": None,
        }
        for i in range(POSITIONS)
    ]
    return {
        "slug": ref,
        "name": "Load test portfolio",
        "totalUsd": round(sum(p["valueUsd"] for p in positions), 2),
        "wallets": [
            {
                "id": "w-1",
                "address": "0x7bfee91193d9df2ac0bfe90191d40f23c773c060",
                "chain": "EVM",
                "label": None,
                "status": "ok",
                "stale": False,
                "totalUsd": round(sum(p["valueUsd"] for p in positions), 2),
                "positions": positions,
            }
        ],
    }


def _completion(message: dict[str, Any], finish: str = "stop") -> dict[str, Any]:
    return {
        "id": "chatcmpl-fake",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "fake",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": USAGE,
    }


def _tool_call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call_fake",
                "type": "function",
                "function": {"name": name, "arguments": json.dumps(arguments)},
            }
        ],
    }


def _answer_for(body: dict[str, Any]) -> dict[str, Any]:
    """What the model would say, decided from what it was asked for.

    The service forces a tool call for its classifiers and binds real tools on
    the grounded branch, so the fake reads the request the same way a provider
    would: whichever tool it was offered is the one it uses.
    """
    offered = {tool.get("function", {}).get("name", "") for tool in (body.get("tools") or [])}
    if "IntentLabel" in offered:
        # Read from the question, so a load profile can decide how many turns
        # take the expensive branch by what it asks rather than by luck.
        asked = str((body.get("messages") or [{}])[-1].get("content", "")).lower()
        intent = "portfolio" if "portfolio" in asked else "general"
        return _tool_call("IntentLabel", {"intent": intent, "reason": "load test"})
    if "ConfirmationDecision" in offered:
        return _tool_call("ConfirmationDecision", {"decision": "other", "reason": "load test"})
    if "Verdict" in offered:
        return _tool_call("Verdict", {"reasoning": "load test", "verdict": "pass"})
    already_looked = any(m.get("role") == "tool" for m in (body.get("messages") or []))
    if "history_summary" in offered and not already_looked:
        # One hop of the agentic loop, then an answer with what came back.
        return _tool_call("history_summary", {"period": "7d"})
    return {"role": "assistant", "content": ANSWER}


async def _stream(message: dict[str, Any]) -> AsyncIterator[str]:
    """The same answer, as the OpenAI wire streams one."""
    head: dict[str, Any] = {"role": "assistant"}
    if message.get("tool_calls"):
        head["tool_calls"] = [{"index": 0, **call} for call in message["tool_calls"]]
        yield f"data: {json.dumps(_chunk(head))}\n\n"
    else:
        yield f"data: {json.dumps(_chunk(head))}\n\n"
        for word in str(message.get("content") or "").split(" "):
            yield f"data: {json.dumps(_chunk({'content': word + ' '}))}\n\n"
    yield f"data: {json.dumps(_chunk({}, finish='stop'))}\n\n"
    yield f"data: {json.dumps({**_chunk({}), 'choices': [], 'usage': USAGE})}\n\n"
    yield "data: [DONE]\n\n"


def _chunk(delta: dict[str, Any], finish: str | None = None) -> dict[str, Any]:
    return {
        "id": "chatcmpl-fake",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": "fake",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


@app.post("/v1/chat/completions")
async def completions(request: Request) -> Any:
    body = await request.json()
    await _wait(MODEL_DELAY_MS)
    message = _answer_for(body)
    if body.get("stream"):
        return StreamingResponse(_stream(message), media_type="text/event-stream")
    return _completion(message, "tool_calls" if message.get("tool_calls") else "stop")


@app.get("/api/auth/me")
async def me() -> dict[str, Any]:
    await _wait(API_DELAY_MS)
    return {"id": "load-user", "portfolios": [{"slug": "load-pf", "name": "Load test"}]}


@app.get("/api/portfolios/{ref}")
async def portfolio(ref: str) -> dict[str, Any]:
    await _wait(API_DELAY_MS)
    return _portfolio(ref)


@app.get("/api/portfolios/{ref}/history")
async def history(ref: str) -> dict[str, Any]:
    await _wait(API_DELAY_MS)
    now = int(time.time() * 1000)
    return {
        "range": "7d",
        "points": [
            {
                "t": now - (300 - i) * 3_600_000,
                "usd": 1_000_000 + i * 137.0,
                "claimableUsd": None,
                "debtUsd": None,
            }
            for i in range(300)
        ],
    }


@app.get("/api/agent/config")
async def config() -> dict[str, Any]:
    return {
        "model": "",
        "reasoningEffort": "",
        "maxTokens": 0,
        "routerModel": "",
        "routerReasoningEffort": "",
        "toolHops": 3,
        "contextMaxPositions": 12,
        "providerSort": "",
        "routerProviderSort": "",
        "product": [{"q": "Which chains?", "a": "EVM, Solana, TRON and Bitcoin."}],
    }


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.getenv("FAKE_PORT", "9099")),
        log_level="warning",
    )
