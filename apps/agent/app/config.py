"""Service configuration, read once from the environment.

Everything tunable lives here and nowhere else, so the *source* of the values
can change without touching the code that uses them — the roadmap is to fetch
this over the network from the host product's API (remote config), and only
this module would learn how.
"""
import os
from dataclasses import dataclass

# English on purpose, like every prompt in this repo: users write in any
# language and the closing instruction makes the agent answer in kind, but the
# prompt itself is code and code is English.
DEFAULT_SYSTEM_PROMPT = (
    "You are the assistant inside svinooh, a DeFi portfolio tracker. Be brief "
    "and concrete.\n"
    "\n"
    "Rules about the portfolio data below, in order of importance:\n"
    "1. Every figure you state must come from the data given to you or from a "
    "tool result. Never estimate, extrapolate or fill a gap from what is "
    "typical. If something was not given, say plainly that you do not have it "
    "— that answer is always better than a number that looks right.\n"
    "2. The position list is the largest few, not all of them. When a line "
    "says how many smaller positions were left out and what they are worth, "
    "those positions exist and their value counts toward the total. Never "
    "present the listed ones as the whole portfolio.\n"
    "3. When a question is about something not in the block — a specific "
    "token, pool, protocol, or how the value moved over time — use a tool "
    "instead of answering from the summary. Say you are looking it up only if "
    "you have already answered the rest.\n"
    "4. The by-network, by-type and by-protocol lines are computed over every "
    "position, so they are the right source for any \"where is my money\" "
    "question. Do not add up the listed positions yourself to answer one.\n"
    "5. History readings are recorded points and can sit slightly behind the "
    "live total. When asked what the portfolio is worth now, quote the live "
    "total; when asked what changed, quote the computed change.\n"
    "6. Quote figures as they are given, with their currency and their sign. "
    "Do not round a value into a different one.\n"
    "\n"
    "With no portfolio data in this prompt, say you cannot see a portfolio "
    "right now and answer the general part of the question. Answer in the "
    "language the user writes in."
)


@dataclass(frozen=True)
class Settings:
    # ── the models ──────────────────────────────────────────────────────────
    # Two models do two jobs, and both are named here rather than in the code
    # that calls them:
    #
    #   AGENT_MODEL         answers — the one the user reads
    #   AGENT_ROUTER_MODEL  labels — intent and confirmation classifiers, a
    #                       dozen output tokens each, so this is where a
    #                       cheaper tier pays off. Empty: the same model
    #                       answers and labels.
    #
    # Both are "<provider>:<model>", resolved by langchain's init_chat_model,
    # so changing vendor is a new value here plus that provider's package —
    # never a code change. Haiku while we iterate: fast, cheap, and every
    # experiment is billed.
    model: str = os.getenv("AGENT_MODEL", "anthropic:claude-haiku-4-5")
    router_model: str = os.getenv("AGENT_ROUTER_MODEL", "")
    # The credentials both models use. Named for this service's own config
    # rather than for whichever vendor is behind it today: the provider SDKs
    # would each read their own variable (ANTHROPIC_API_KEY, OPENAI_API_KEY,
    # GOOGLE_API_KEY...), which turns "switch the model" into "also learn what
    # this vendor calls its key". Passed explicitly to the client instead, so
    # one pair of names covers every provider. Empty key — the provider plugin
    # falls back to its own variable, which keeps existing deployments working.
    model_api_key: str = os.getenv("AGENT_MODEL_API_KEY", "")
    # One endpoint for many vendors (OpenRouter and the like): when set, model
    # calls go to this OpenAI-compatible base URL instead of the provider's own
    # — one key, any vendor's model, chosen by AGENT_MODEL alone
    # (e.g. AGENT_MODEL=openai:google/gemini-2.5-flash). Empty — direct.
    model_base_url: str = os.getenv("AGENT_MODEL_BASE_URL", "")
    # How hard the answering model may think before it starts writing.
    # Reasoning models spend real seconds here, and a chat is a place where a
    # person is watching a cursor — "low" buys most of the quality for a
    # fraction of the wait. Empty leaves the model's own default alone; the
    # values an OpenAI-compatible aggregator accepts are none/minimal/low/
    # medium/high.
    reasoning_effort: str = os.getenv("AGENT_REASONING_EFFORT", "low")
    # The classifiers barely think: they pick one of two labels from one
    # sentence, and they sit on the critical path in front of every answer.
    # Not "none": some endpoints mandate reasoning and reject a request that
    # switches it off, which is a 400 on every turn (the service now drops the
    # budget by itself when that happens, but the default should not need it).
    router_reasoning_effort: str = os.getenv("AGENT_ROUTER_REASONING_EFFORT", "low")
    system_prompt: str = os.getenv("AGENT_SYSTEM", DEFAULT_SYSTEM_PROMPT)
    max_tokens: int = int(os.getenv("AGENT_MAX_TOKENS", "1024"))
    request_timeout_s: int = int(os.getenv("AGENT_TIMEOUT_S", "60"))
    # Conversation memory: how many messages a session keeps, and for how long
    # a silent session survives before it is forgotten.
    history_max_messages: int = int(os.getenv("AGENT_HISTORY_MAX_MESSAGES", "40"))
    history_ttl_s: int = int(os.getenv("AGENT_HISTORY_TTL_S", "1800"))
    # The portfolio public API — DataSource #1 (see app/datasources.py). The
    # agent speaks to it over plain HTTP with the caller's token, like any
    # third-party client. On Railway this is the api service's private domain.
    portfolio_api_url: str = os.getenv("PORTFOLIO_API_URL", "http://localhost:3000")
    # A context fetch rides inside a chat turn; when it is slow, answering
    # without it beats making the person wait for it.
    context_timeout_s: int = int(os.getenv("AGENT_CONTEXT_TIMEOUT_S", "10"))
    # Origins allowed to call this service from a browser, comma-separated
    # (the portfolio web app, later the standalone agent app). Empty — no
    # cross-origin caller is allowed, which is right while the only door is
    # the server-side gateway.
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv("AGENT_CORS_ORIGINS", "").split(",")
        if origin.strip()
    )
    # How long a positive token validation stands before the host is asked
    # again. Short on purpose: a validation only names the caller — data calls
    # always carry the live token to the host.
    auth_cache_ttl_s: int = int(os.getenv("AGENT_AUTH_CACHE_TTL_S", "60"))
    # The cost lock: how many chat turns one caller gets per window. Every
    # turn is at least one paid model call, several when tools run.
    rate_limit_requests: int = int(os.getenv("AGENT_RATE_LIMIT_REQUESTS", "20"))
    rate_limit_window_s: int = int(os.getenv("AGENT_RATE_LIMIT_WINDOW_S", "300"))
    # How many rounds of tool calls one grounded turn may take before the
    # model is asked to answer with what it has. A cap, not a target: most
    # turns take zero or one.
    tool_hops: int = int(os.getenv("AGENT_TOOL_HOPS", "3"))
    # How many positions per wallet the context block carries (largest first,
    # so what falls off the end is dust by construction). A knob, not gospel:
    # the whole context is billed on every turn of a conversation, and the
    # planned complement is a drill-down tool the model calls for specifics
    # rather than an ever-fatter static block.
    context_max_positions: int = int(os.getenv("AGENT_CONTEXT_MAX_POSITIONS", "12"))


settings = Settings()
