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
    "Be brief and to the point. You do not have access to the numbers of a "
    "specific portfolio yet — that is the next step; answer general questions "
    "about DeFi and the app. Answer in the language the user writes in."
)


@dataclass(frozen=True)
class Settings:
    # "<provider>:<model>" — the whole provider choice lives in this one string
    # (resolved by langchain's init_chat_model), so moving to e.g. Gemini is a
    # new value here plus that provider's langchain package, not a code change.
    # Haiku while we iterate: fast and cheap, and every experiment is billed.
    model: str = os.getenv("AGENT_MODEL", "anthropic:claude-haiku-4-5")
    system_prompt: str = os.getenv("AGENT_SYSTEM", DEFAULT_SYSTEM_PROMPT)
    max_tokens: int = int(os.getenv("AGENT_MAX_TOKENS", "1024"))
    request_timeout_s: int = int(os.getenv("AGENT_TIMEOUT_S", "60"))
    # Conversation memory: how many messages a session keeps, and for how long
    # a silent session survives before it is forgotten.
    history_max_messages: int = int(os.getenv("AGENT_HISTORY_MAX_MESSAGES", "40"))
    history_ttl_s: int = int(os.getenv("AGENT_HISTORY_TTL_S", "1800"))


settings = Settings()
