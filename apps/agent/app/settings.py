"""Everything the environment decides, read and checked once at boot.

One object, validated by pydantic-settings: a value that is not a number, or
a number that makes no sense, stops the service before it answers anything,
with the offending variable named. The admin panel's live decisions are not
here; they arrive over HTTP (app/adapters/panel.py) and app/config.py layers
them on top of this.
"""

from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """The AGENT_* environment, plus the two variables shared with the neighbours."""

    model_config = SettingsConfigDict(
        env_prefix="AGENT_", frozen=True, extra="ignore", populate_by_name=True
    )

    # ── the account every role calls through ────────────────────────────────
    model_api_key: str = ""
    # An OpenAI-compatible endpoint (OpenRouter and the like): one key, any
    # vendor's model, chosen by the model name alone. Empty means direct.
    model_base_url: str = ""
    # Which of an aggregator's providers may serve us. "deny" refuses the ones
    # that keep or train on the prompt; ours carry wallet addresses.
    provider_data_collection: str = "deny"
    # Off on purpose: it demands a provider advertise EVERY parameter we send,
    # and the client adds parallel_tool_calls on its own, which none advertise.
    provider_require_parameters: bool = False

    # ── the answering role: what the user reads ─────────────────────────────
    model: str = "anthropic:claude-haiku-4-5"
    reasoning_effort: str = "minimal"
    max_tokens: int = Field(1024, ge=1)
    provider_sort: str = "throughput"

    # ── the labelling role: the intent and confirmation classifiers ─────────
    # An empty model runs the job on the answering one. The thinking setting
    # ships empty because it is the only value every model can honour: one
    # that must think refuses being told to stop, one that cannot is filtered
    # away for being asked.
    router_model: str = ""
    router_reasoning_effort: str = ""
    router_max_tokens: int = Field(200, ge=1)
    router_provider_sort: str = "throughput"

    # ── the turn ────────────────────────────────────────────────────────────
    # An override for the shipped system prompt (app/config.py); empty keeps it.
    system_prompt: str = Field("", validation_alias="AGENT_SYSTEM")
    tool_hops: int = Field(3, ge=0)
    context_max_positions: int = Field(12, ge=1)
    request_timeout_s: int = Field(60, ge=1, validation_alias="AGENT_TIMEOUT_S")
    # A context fetch rides inside a turn: past this, answer without it.
    context_timeout_s: int = Field(10, ge=1)

    # ── conversations ───────────────────────────────────────────────────────
    # Messages replayed to the model; a turn is two, so 40 is twenty exchanges.
    history_max_messages: int = Field(40, ge=2)
    # Turns a conversation keeps at all: more than the model sees, because a
    # reader scrolls back further than the model is replayed.
    chat_max_turns: int = Field(100, ge=1)
    chat_list_limit: int = Field(50, ge=1)

    # ── the doors ───────────────────────────────────────────────────────────
    # Browser origins allowed in, comma-separated. Empty: no cross-origin caller.
    cors_origins: Annotated[tuple[str, ...], NoDecode] = ()
    auth_cache_ttl_s: int = Field(60, ge=0)
    # What a visitor gets before the answer is the sign-in card, per window.
    free_questions: int = Field(5, ge=0)
    free_window_s: int = Field(86400, ge=1)
    # The cost lock: turns per caller per window; every turn is paid model calls.
    rate_limit_requests: int = Field(20, ge=1)
    rate_limit_window_s: int = Field(300, ge=1)

    # ── the neighbours ──────────────────────────────────────────────────────
    # The agent's own store. Empty keeps conversations and counters in-process.
    redis_url: str = Field("", validation_alias="REDIS_URL")
    # The portfolio public API, spoken to with the caller's own token.
    portfolio_api_url: str = Field("http://localhost:3000", validation_alias="PORTFOLIO_API_URL")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(origin.strip() for origin in value.split(",") if origin.strip())
        return value

    @field_validator("reasoning_effort", "router_reasoning_effort")
    @classmethod
    def _default_means_nothing(cls, value: str) -> str:
        # "default" is how the panel writes the empty setting, and an
        # environment may copy it. Both mean: send no instruction.
        return "" if value == "default" else value


#: Read at import for now; the composition root takes this over in step 3.
settings = Settings()
