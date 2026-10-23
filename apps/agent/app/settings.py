from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_", frozen=True, extra="ignore", populate_by_name=True
    )

    model_api_key: str = ""
    model_base_url: str = ""
    provider_data_collection: str = "deny"
    provider_require_parameters: bool = False

    model: str = "anthropic:claude-haiku-4-5"
    reasoning_effort: str = "minimal"
    max_tokens: int = Field(1024, ge=1)
    provider_sort: str = "throughput"

    router_model: str = ""
    router_reasoning_effort: str = ""
    router_max_tokens: int = Field(200, ge=1)
    router_provider_sort: str = "throughput"

    turn_timeout_s: int = Field(120, ge=1)
    model_max_in_flight: int = Field(32, ge=1)
    message_max_chars: int = Field(4000, ge=1)
    http_max_connections: int = Field(100, ge=1)
    http_keepalive_connections: int = Field(20, ge=0)
    http_connect_timeout_s: float = Field(5.0, gt=0)
    auth_cache_max: int = Field(10_000, ge=1)

    system_prompt: str = Field("", validation_alias="AGENT_SYSTEM")
    tool_hops: int = Field(3, ge=0)
    tracing: bool = True
    context_max_positions: int = Field(12, ge=1)
    request_timeout_s: int = Field(60, ge=1, validation_alias="AGENT_TIMEOUT_S")
    context_timeout_s: int = Field(10, ge=1)

    history_max_messages: int = Field(40, ge=2)
    chat_max_turns: int = Field(100, ge=1)
    chat_list_limit: int = Field(50, ge=1)

    cors_origins: Annotated[tuple[str, ...], NoDecode] = ()
    auth_cache_ttl_s: int = Field(60, ge=0)
    free_questions: int = Field(5, ge=0)
    free_window_s: int = Field(86400, ge=1)
    rate_limit_requests: int = Field(20, ge=1)
    rate_limit_window_s: int = Field(300, ge=1)

    redis_url: str = Field("", validation_alias="REDIS_URL")
    portfolio_api_url: str = Field("http://localhost:3000", validation_alias="PORTFOLIO_API_URL")
    earn_api_url: str = Field("http://localhost:8080", validation_alias="EARN_API_URL")
    mcp_url: str = "http://localhost:3010/mcp"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(origin.strip() for origin in value.split(",") if origin.strip())
        return value

    @field_validator("reasoning_effort", "router_reasoning_effort")
    @classmethod
    def _default_means_nothing(cls, value: str) -> str:
        return "" if value == "default" else value
