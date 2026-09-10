"""The HTTP surface: the envelope, the numbers, and what a failure looks like."""
from datetime import timedelta

from fastapi.testclient import TestClient

SENTORA = "sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK"


def test_a_list_says_when_it_was_read(client: TestClient):
    body = client.get("/v1/lend/pools").json()
    assert body["meta"]["stale"] is False
    assert body["meta"]["total"] == 4
    assert body["meta"]["next_cursor"] is None
    assert body["meta"]["degraded"] == []


def test_rates_and_money_cross_the_wire_as_strings(client: TestClient):
    """A JSON number becomes a double in the client. These must not."""
    top = client.get("/v1/lend/pools").json()["data"][0]
    assert top["apy"]["net"] == "0.050794"
    assert top["apy"]["base"] == "0.025751"
    assert top["tvl_usd"] == "135323782.29"


def test_the_detail_endpoint_carries_what_signing_will_need(client: TestClient):
    pool = client.get(f"/v1/lend/pools/{SENTORA}").json()["data"]
    assert pool["deposit"]["program_id"] == "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
    assert pool["deposit"]["min_amount"] == "0.100000000"
    assert pool["fees"] == {"performance_bps": 500, "management_bps": 0}
    assert len(pool["allocations"]) == 2
    assert pool["apy_windows"]["d30"] == "0.062558"


def test_filters_are_query_parameters(client: TestClient):
    body = client.get("/v1/lend/pools", params={"token": "pyusd", "kind": "vault"}).json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["token"]["symbol"] == "PYUSD"


def test_paging_walks_the_same_list(client: TestClient):
    first = client.get("/v1/lend/pools", params={"limit": 2}).json()
    cursor = first["meta"]["next_cursor"]
    second = client.get("/v1/lend/pools", params={"limit": 2, "cursor": cursor}).json()

    assert {pool["id"] for pool in first["data"]}.isdisjoint(pool["id"] for pool in second["data"])
    assert second["meta"]["catalog"] == first["meta"]["catalog"]


def test_tokens_answers_what_can_i_do_with_this(client: TestClient):
    rows = client.get("/v1/lend/tokens").json()["data"]
    pyusd = next(row for row in rows if row["symbol"] == "PYUSD")
    assert pyusd["pool_count"] == 3
    assert pyusd["best_pool_id"].startswith("sol:kamino:vault:")
    assert pyusd["best_apy"] == "0.050794"


def test_an_answer_admits_when_it_is_old(client: TestClient, clock):
    clock.advance(timedelta(hours=1))
    assert client.get("/v1/lend/pools").json()["meta"]["stale"] is True
