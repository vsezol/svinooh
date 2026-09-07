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
    "You are the assistant inside svinooh, a DeFi portfolio tracker. "
    "Be brief and to the point. When portfolio data is provided in this "
    "prompt, ground your answers in it — quote its actual numbers. When it is "
    "not, say you cannot see the portfolio right now and answer the general "
    "question instead. Answer in the language the user writes in."
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
