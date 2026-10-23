import base64
import json
import secrets
import time
from urllib.parse import urlparse

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import BaseModel
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from svinooh_portfolio.source import DataSource, UnknownTokenError

from .store import Store

PREFIX = "svm_"

REQUEST_TTL = 600

CODE_TTL = 300

TOKEN_TTL = 30 * 24 * 3600

CLIENT_TTL = 90 * 24 * 3600

REDIRECT_HOSTS = frozenset({"claude.ai", "claude.com", "localhost", "127.0.0.1"})


class Granted(AuthorizationCode):
    svinooh: str


class Asked(BaseModel):
    client_id: str
    params: AuthorizationParams


class Issued(BaseModel):
    client_id: str
    svinooh: str
    subject: str
    expires_at: int


class SvinoohOAuth(OAuthAuthorizationServerProvider[Granted, RefreshToken, AccessToken]):
    """svinooh as an OAuth authorization server for MCP clients.

    The person approves on svinooh.com, signed in as themselves; the client gets
    a token of its own, behind which the server keeps their svinooh session and
    reads with it. A svinooh session token sent as is also reads, for clients
    configured by hand.
    """

    def __init__(self, store: Store, source: DataSource, web_url: str) -> None:
        self._store = store
        self._source = source
        self._web = web_url.rstrip("/")

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        raw = await self._store.get(f"client:{client_id}")
        return OAuthClientInformationFull.model_validate_json(raw) if raw else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        for uri in client_info.redirect_uris or []:
            if urlparse(str(uri)).hostname not in REDIRECT_HOSTS:
                raise RegistrationError(
                    "invalid_redirect_uri", f"{uri} is not a client svinooh lets in"
                )
        await self._store.put(
            f"client:{client_info.client_id}", client_info.model_dump_json(), CLIENT_TTL
        )

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        request = secrets.token_urlsafe(24)
        asked = Asked(client_id=str(client.client_id), params=params)
        await self._store.put(f"request:{request}", asked.model_dump_json(), REQUEST_TTL)
        return f"{self._web}/connect?request={request}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> Granted | None:
        raw = await self._store.get(f"code:{authorization_code}")
        granted = Granted.model_validate_json(raw) if raw else None
        return granted if granted and granted.client_id == client.client_id else None

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: Granted
    ) -> OAuthToken:
        await self._store.drop(f"code:{authorization_code.code}")
        token = PREFIX + secrets.token_urlsafe(32)
        expires_at = min(expiry(authorization_code.svinooh), int(time.time()) + TOKEN_TTL)
        issued = Issued(
            client_id=authorization_code.client_id,
            svinooh=authorization_code.svinooh,
            subject=authorization_code.subject or "",
            expires_at=expires_at,
        )
        lasts = max(expires_at - int(time.time()), 1)
        await self._store.put(f"token:{token}", issued.model_dump_json(), lasts)
        await self.register_client(client)
        return OAuthToken(access_token=token, token_type="Bearer", expires_in=lasts)

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        return None

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        raise TokenError("invalid_grant", "svinooh issues no refresh tokens: connect again")

    async def load_access_token(self, token: str) -> AccessToken | None:
        if token.startswith(PREFIX):
            raw = await self._store.get(f"token:{token}")
            if raw is None:
                return None
            issued = Issued.model_validate_json(raw)
            return AccessToken(
                token=token,
                client_id=issued.client_id,
                scopes=[],
                expires_at=issued.expires_at,
                subject=issued.subject,
                claims={"svinooh": issued.svinooh},
            )
        expires_at = expiry(token)
        if expires_at <= time.time():
            return None
        return AccessToken(
            token=token,
            client_id="svinooh",
            scopes=[],
            expires_at=expires_at,
            claims={"svinooh": token},
        )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        await self._store.drop(f"token:{token.token}")

    def routes(self) -> list[Route]:
        """The svinooh.com consent page's three calls: who is asking, yes, no."""
        return [
            Route("/oauth/requests/{request}", self._asked, methods=["GET"]),
            Route("/oauth/requests/{request}/approve", self._approve, methods=["POST"]),
            Route("/oauth/requests/{request}/deny", self._deny, methods=["POST"]),
        ]

    async def _asked(self, request: Request) -> JSONResponse:
        found = await self._pending(request.path_params["request"])
        if found is None:
            return _gone()
        asked, client = found
        return JSONResponse(
            {
                "client": client.client_name or asked.client_id,
                "redirect": urlparse(str(asked.params.redirect_uri)).hostname,
            }
        )

    async def _approve(self, request: Request) -> JSONResponse:
        session = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if not session:
            return JSONResponse({"error": "sign in first"}, status_code=401)
        try:
            me = await self._source.me(f"Bearer {session}")
        except UnknownTokenError:
            return JSONResponse({"error": "the svinooh session was refused"}, status_code=401)
        raw = await self._store.take(f"request:{request.path_params['request']}")
        if raw is None:
            return _gone()
        asked = Asked.model_validate_json(raw)
        code = secrets.token_urlsafe(32)
        granted = Granted(
            code=code,
            scopes=asked.params.scopes or [],
            expires_at=time.time() + CODE_TTL,
            client_id=asked.client_id,
            code_challenge=asked.params.code_challenge,
            redirect_uri=asked.params.redirect_uri,
            redirect_uri_provided_explicitly=asked.params.redirect_uri_provided_explicitly,
            resource=asked.params.resource,
            subject=me.user_id,
            svinooh=session,
        )
        await self._store.put(f"code:{code}", granted.model_dump_json(), CODE_TTL)
        redirect = construct_redirect_uri(
            str(asked.params.redirect_uri), code=code, state=asked.params.state
        )
        return JSONResponse({"redirect": redirect})

    async def _deny(self, request: Request) -> JSONResponse:
        raw = await self._store.take(f"request:{request.path_params['request']}")
        if raw is None:
            return _gone()
        asked = Asked.model_validate_json(raw)
        redirect = construct_redirect_uri(
            str(asked.params.redirect_uri), error="access_denied", state=asked.params.state
        )
        return JSONResponse({"redirect": redirect})

    async def _pending(self, request: str) -> tuple[Asked, OAuthClientInformationFull] | None:
        raw = await self._store.get(f"request:{request}")
        if raw is None:
            return None
        asked = Asked.model_validate_json(raw)
        client = await self.get_client(asked.client_id)
        return (asked, client) if client else None


def expiry(session: str) -> int:
    """When a svinooh session token stops working, read off its own `exp`.

    Not a verification: the API checks the signature on every read. A token
    that is not a JWT has expired as far as this server is concerned.
    """
    try:
        payload = session.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return int(claims["exp"])
    except (IndexError, ValueError, KeyError, TypeError):
        return 0


def _gone() -> JSONResponse:
    return JSONResponse({"error": "this request expired or was already answered"}, status_code=404)
