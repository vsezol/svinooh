"""The HTTP surface: status codes, the envelope, and what a number looks like."""
import pytest
from fastapi.testclient import TestClient

from app import create_app
from app.catalog import catalog


@pytest.fixture
def client(snapshot, monkeypatch):
    # The refresh loop is not what these tests are about, and it would reach
    # for the network on startup.
    monkeypatch.setattr(catalog, "_snapshots", [snapshot])
    app = create_app()
    return TestClient(app)


def test_health_reports_the_snapshot_not_just_the_process(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["snapshot"] == 7
    assert body["stale"] is False


def test_a_list_carries_when_it_was_read(client):
    body = client.get("/v1/lend/pools").json()
    assert body["meta"]["as_of"]
    assert body["meta"]["stale"] is False
    assert body["meta"]["total"] == 4
    assert body["meta"]["next_cursor"] is None


def test_rates_and_money_cross_the_wire_as_strings(client):
    """A JSON number becomes a double in the client. These must not."""
    top = client.get("/v1/lend/pools").json()["data"][0]
    assert top["apy"]["net"] == "0.050794"
    assert top["apy"]["base"] == "0.025751"
    assert top["tvl_usd"] == "135323782.29"


def test_the_detail_endpoint_carries_what_signing_will_need(client):
    body = client.get("/v1/lend/pools/sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK").json()
    pool = body["data"]
    assert pool["deposit"]["program_id"] == "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
    assert pool["deposit"]["min_amount"] == "0.100000000"
    assert pool["fees"] == {"performance_bps": 500, "management_bps": 0}
    assert len(pool["allocations"]) == 2
    assert pool["apy_windows"]["d30"] == "0.062558"


def test_an_unknown_pool_is_a_problem_document(client):
    response = client.get("/v1/lend/pools/sol:kamino:vault:nope")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"].endswith("/not-found")


def test_a_stale_cursor_says_which_kind_of_wrong_it_is(client):
    response = client.get("/v1/lend/pools", params={"cursor": "not-a-cursor"})
    assert response.status_code == 400
    assert response.json()["type"].endswith("/invalid-cursor")


def test_tokens_answers_what_can_i_do_with_this(client):
    rows = client.get("/v1/lend/tokens").json()["data"]
    pyusd = next(row for row in rows if row["symbol"] == "PYUSD")
    # One vault and two reserves take PYUSD; the vault pays best
    assert pyusd["pool_count"] == 3
    assert pyusd["best_pool_id"].startswith("sol:kamino:vault:")
    assert pyusd["best_apy"] == "0.050794"


def test_not_ready_is_not_the_same_as_no_pools(monkeypatch):
    monkeypatch.setattr(catalog, "_snapshots", [])
    client = TestClient(create_app())
    assert client.get("/health").status_code == 503
    response = client.get("/v1/lend/pools")
    assert response.status_code == 503
    assert response.json()["type"].endswith("/not-ready")
