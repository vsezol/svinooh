"""Every failure, as a problem document a program can branch on."""
from fastapi.testclient import TestClient

PROBLEM = "application/problem+json"


def kind(response) -> str:
    return str(response.json()["type"]).rsplit("/", 1)[-1]


def test_an_unknown_pool_is_a_problem_document(client: TestClient):
    response = client.get("/v1/lend/pools/sol:kamino:vault:nope")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith(PROBLEM)
    assert kind(response) == "not-found"


def test_a_malformed_cursor_says_which_kind_of_wrong_it_is(client: TestClient):
    response = client.get("/v1/lend/pools", params={"cursor": "not-a-cursor"})
    assert response.status_code == 400
    assert kind(response) == "invalid-cursor"


def test_a_cursor_from_another_query_is_refused(client: TestClient):
    cursor = client.get("/v1/lend/pools", params={"limit": 1}).json()["meta"]["next_cursor"]
    params = {"limit": 1, "cursor": cursor, "kind": "reserve"}
    response = client.get("/v1/lend/pools", params=params)
    assert response.status_code == 400
    assert kind(response) == "cursor-query-mismatch"


def test_an_unknown_filter_value_is_refused_before_any_of_our_code_runs(client: TestClient):
    response = client.get("/v1/lend/pools", params={"network": "ethereum"})
    assert response.status_code == 422
    assert kind(response) == "invalid-parameter"
    assert "network" in response.json()["detail"]


def test_an_unknown_sort_lists_what_was_allowed(client: TestClient):
    response = client.get("/v1/lend/pools", params={"sort": "apy_desc"})
    assert response.status_code == 422
    assert kind(response) == "invalid-parameter"


def test_not_ready_is_not_the_same_as_no_pools(cold_client: TestClient):
    """503 and an empty list mean opposite things to whoever is asking."""
    response = cold_client.get("/v1/lend/pools")
    assert response.status_code == 503
    assert kind(response) == "not-ready"
