"""What every test starts from: an environment with none of ours in it.

The service reads AGENT_*, REDIS_URL and PORTFOLIO_API_URL. A developer's
shell may carry any of them, and a test that silently picks one up passes on
one machine and fails on another. AGENT_TEST_* is the suite's own and stays.
"""

import os

import pytest


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in list(os.environ):
        ours = key.startswith("AGENT_") and not key.startswith("AGENT_TEST_")
        if ours or key in ("REDIS_URL", "PORTFOLIO_API_URL", "PORT"):
            monkeypatch.delenv(key, raising=False)
