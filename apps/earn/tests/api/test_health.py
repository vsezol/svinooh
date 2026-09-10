"""Readiness: the deployment gate, so it must mean "can answer"."""
from datetime import timedelta

from fastapi.testclient import TestClient


def test_health_reports_the_catalog_not_just_the_process(client: TestClient):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["catalog"] == 1
    assert body["pools"] == 4
    assert body["stale"] is False
    assert body["age_s"] == 0


def test_health_ages_with_the_catalog(client: TestClient, clock):
    clock.advance(timedelta(minutes=30))
    body = client.get("/health").json()
    assert body["stale"] is True
    assert body["age_s"] == 1800


def test_a_service_with_nothing_to_serve_must_not_replace_one_that_works(cold_client: TestClient):
    response = cold_client.get("/health")
    assert response.status_code == 503
    assert response.json()["status"] == "starting"
