import os

import pytest


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in list(os.environ):
        ours = key.startswith("AGENT_") and not key.startswith("AGENT_TEST_")
        tracing = key.startswith("LANGFUSE_") or key == "RAILWAY_GIT_COMMIT_SHA"
        if ours or tracing or key in ("REDIS_URL", "PORTFOLIO_API_URL", "PORT"):
            monkeypatch.delenv(key, raising=False)
