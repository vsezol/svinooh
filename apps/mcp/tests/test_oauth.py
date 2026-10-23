import base64
import hashlib
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from app.oauth import expiry
from tests.test_server import SESSION, Host, app_for, called, session_token

CLAUDE = "https://claude.ai/api/mcp/auth_callback"


@asynccontextmanager
async def served(host: Host) -> AsyncIterator[httpx2.AsyncClient]:
    app = app_for(host)
    async with (
        app.router.lifespan_context(app),
        httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://localhost"
        ) as http,
    ):
        yield http


async def registered(http: httpx2.AsyncClient, redirect: str = CLAUDE) -> httpx2.Response:
    return await http.post(
        "/register",
        json={
            "client_name": "Claude",
            "redirect_uris": [redirect],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
        },
    )


async def asked(http: httpx2.AsyncClient) -> tuple[str, str, str]:
    """A client registered and sent to the consent page: (client id, verifier, request)."""
    client = (await registered(http)).json()["client_id"]
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
    sent = await http.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": client,
            "redirect_uri": CLAUDE,
            "code_challenge": challenge.decode().rstrip("="),
            "code_challenge_method": "S256",
            "state": "st8",
        },
    )
    assert sent.status_code == 302
    consent = urlparse(sent.headers["location"])
    assert f"{consent.scheme}://{consent.netloc}{consent.path}" == "https://svinooh.com/connect"
    return client, verifier, parse_qs(consent.query)["request"][0]


class TestFindingTheWayIn:
    async def test_a_request_without_a_token_is_told_where_to_get_one(self):
        async with served(Host()) as http:
            refused = await http.post("/mcp", json={})
            resource = await http.get("/.well-known/oauth-protected-resource/mcp")
            server = await http.get("/.well-known/oauth-authorization-server")
        assert refused.status_code == 401
        assert "resource_metadata" in refused.headers["www-authenticate"]
        assert resource.json()["authorization_servers"] == ["http://localhost"]
        assert server.json()["issuer"] == "http://localhost", "the two must match to the letter"
        assert resource.json()["resource"] == "http://localhost/mcp"
        assert server.json()["registration_endpoint"] == "http://localhost/register"

    async def test_only_claude_and_this_machine_may_register(self):
        async with served(Host()) as http:
            evil = await registered(http, "https://evil.example/callback")
            local = await registered(http, "http://localhost:6274/oauth/callback")
        assert evil.status_code == 400
        assert evil.json()["error"] == "invalid_redirect_uri"
        assert local.status_code == 201


class TestConnecting:
    async def test_a_yes_on_svinooh_com_becomes_a_token_that_reads_as_that_person(self):
        host = Host()
        async with served(host) as http:
            client, verifier, request = await asked(http)
            shown = (await http.get(f"/oauth/requests/{request}")).json()
            approved = await http.post(
                f"/oauth/requests/{request}/approve", headers={"authorization": SESSION}
            )
            back = parse_qs(urlparse(approved.json()["redirect"]).query)
            token = await http.post(
                "/token",
                data={
                    "grant_type": "authorization_code",
                    "code": back["code"][0],
                    "redirect_uri": CLAUDE,
                    "client_id": client,
                    "code_verifier": verifier,
                },
            )
            access = token.json()["access_token"]
            http.headers["authorization"] = f"Bearer {access}"
            async with (
                streamable_http_client("http://localhost/mcp", http_client=http) as (r, w),
                ClientSession(r, w) as session,
            ):
                await session.initialize()
                _, owned = await called(session, "my_portfolios")
        assert shown == {"client": "Claude", "redirect": "claude.ai"}
        assert back["state"] == ["st8"]
        assert access.startswith("svm_")
        assert owned == "- Main (id main)"
        assert host.tokens[-1] == SESSION, "it reads with the session that approved it"

    async def test_a_no_sends_the_client_away_and_the_request_is_spent(self):
        async with served(Host()) as http:
            _, _, request = await asked(http)
            denied = await http.post(f"/oauth/requests/{request}/deny")
            again = await http.post(
                f"/oauth/requests/{request}/approve", headers={"authorization": SESSION}
            )
        back = parse_qs(urlparse(denied.json()["redirect"]).query)
        assert back["error"] == ["access_denied"]
        assert back["state"] == ["st8"]
        assert again.status_code == 404

    async def test_approving_needs_a_session_svinooh_accepts(self):
        async with served(Host(refused=True)) as http:
            _, _, request = await asked(http)
            anonymous = await http.post(f"/oauth/requests/{request}/approve")
            refused = await http.post(
                f"/oauth/requests/{request}/approve", headers={"authorization": SESSION}
            )
            still = await http.get(f"/oauth/requests/{request}")
        assert anonymous.status_code == 401
        assert refused.status_code == 401
        assert still.status_code == 200, "a refusal does not spend the request"

    async def test_only_svinooh_com_may_ask_from_a_browser(self):
        async with served(Host()) as http:
            ours = await http.options(
                "/oauth/requests/x/approve",
                headers={
                    "origin": "https://svinooh.com",
                    "access-control-request-method": "POST",
                    "access-control-request-headers": "authorization",
                },
            )
            theirs = await http.options(
                "/oauth/requests/x/approve",
                headers={"origin": "https://evil.example", "access-control-request-method": "POST"},
            )
        assert ours.headers["access-control-allow-origin"] == "https://svinooh.com"
        assert "access-control-allow-origin" not in theirs.headers


class TestASessionSentAsIs:
    async def test_an_expired_session_is_refused_before_it_reads(self):
        stale = f"Bearer {session_token(time.time() - 60)}"
        async with served(Host()) as http:
            refused = await http.post("/mcp", json={}, headers={"authorization": stale})
        assert refused.status_code == 401

    def test_its_expiry_is_read_off_the_token(self):
        assert expiry(session_token(1_900_000_000)) == 1_900_000_000
        assert expiry("not-a-jwt") == 0
