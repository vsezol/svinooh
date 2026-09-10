"""The environment as one checked object, and what a wrong value does.

Before this, every variable was read with int(os.getenv(...)) at import: a
typo in one of them was a traceback from the middle of a module, and a
negative number was accepted and found out later.
"""

import pytest
from pydantic import ValidationError

from app.settings import Settings


class TestReadingTheEnvironment:
    def test_the_defaults_run_with_nothing_set(self):
        settings = Settings()
        assert settings.model == "anthropic:claude-haiku-4-5"
        assert settings.redis_url == "" and settings.cors_origins == ()
        assert settings.tool_hops == 3 and settings.rate_limit_requests == 20

    def test_every_variable_keeps_its_name(self, monkeypatch):
        # The names deployments already set — including the three that predate
        # the AGENT_ prefix or never had it.
        monkeypatch.setenv("AGENT_MODEL", "openai:from-env")
        monkeypatch.setenv("AGENT_ROUTER_MAX_TOKENS", "300")
        monkeypatch.setenv("AGENT_SYSTEM", "be terse")
        monkeypatch.setenv("AGENT_TIMEOUT_S", "7")
        monkeypatch.setenv("REDIS_URL", "redis://somewhere")
        monkeypatch.setenv("PORTFOLIO_API_URL", "http://api")
        settings = Settings()
        assert (settings.model, settings.router_max_tokens) == ("openai:from-env", 300)
        assert (settings.system_prompt, settings.request_timeout_s) == ("be terse", 7)
        assert (settings.redis_url, settings.portfolio_api_url) == (
            "redis://somewhere",
            "http://api",
        )

    def test_origins_are_a_comma_separated_list(self, monkeypatch):
        monkeypatch.setenv("AGENT_CORS_ORIGINS", "https://svinooh.com, https://ai.svinooh.com,")
        assert Settings().cors_origins == ("https://svinooh.com", "https://ai.svinooh.com")

    def test_a_flag_is_read_the_way_the_env_example_writes_it(self, monkeypatch):
        monkeypatch.setenv("AGENT_PROVIDER_REQUIRE_PARAMETERS", "1")
        assert Settings().provider_require_parameters is True
        monkeypatch.setenv("AGENT_PROVIDER_REQUIRE_PARAMETERS", "0")
        assert Settings().provider_require_parameters is False

    def test_default_is_the_word_for_no_thinking_instruction(self, monkeypatch):
        monkeypatch.setenv("AGENT_REASONING_EFFORT", "default")
        assert Settings().reasoning_effort == ""

    def test_a_variable_we_do_not_know_is_not_an_error(self, monkeypatch):
        monkeypatch.setenv("AGENT_SOMETHING_ELSE", "1")
        Settings()

    def test_a_test_can_build_its_own_without_touching_the_shell(self):
        assert Settings(model="openai:mine", tool_hops=1).tool_hops == 1


class TestFailingFast:
    """A wrong value stops the service at boot, naming what was wrong."""

    @pytest.mark.parametrize(
        ("name", "value", "named"),
        [
            ("AGENT_TIMEOUT_S", "abc", "(?i)timeout"),
            ("AGENT_TOOL_HOPS", "-1", "tool_hops"),
            ("AGENT_MAX_TOKENS", "0", "max_tokens"),
            ("AGENT_HISTORY_MAX_MESSAGES", "1", "history_max_messages"),
        ],
    )
    def test_a_value_that_makes_no_sense_is_refused(self, monkeypatch, name, value, named):
        monkeypatch.setenv(name, value)
        with pytest.raises(ValidationError, match=named):
            Settings()

    def test_the_object_is_frozen(self):
        with pytest.raises(ValidationError):
            Settings().model = "openai:something-else"
