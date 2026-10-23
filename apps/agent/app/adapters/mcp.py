from collections.abc import Awaitable, Callable

import httpx
from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.interceptors import MCPToolCallRequest, MCPToolCallResult

PORTFOLIO_TOOLS = frozenset({"position_details", "asset_breakdown", "history_summary", "calculate"})

EARN_TOOLS = frozenset({"calculate", "earn_options"})

PINNED = "portfolio"

SERVER = "svinooh"

Handler = Callable[[MCPToolCallRequest], Awaitable[MCPToolCallResult]]


class McpTools:
    """The svinooh MCP server, read with the caller's own token.

    The portfolio is the turn's, never the model's to pass: it is taken out of
    every tool's schema and put back into every call. A turn with no token is
    read at `anonymous`, the server's endpoint on the private network that
    reads as nobody: the public one answers a request without a token 401.
    """

    def __init__(
        self, url: str, anonymous: str, http: Callable[..., httpx.AsyncClient] | None = None
    ) -> None:
        self._url = url
        self._anonymous = anonymous
        self._http = http

    async def overview(self, slug: str, token: str | None, positions: int) -> str:
        async with self._client(token).session(SERVER) as session:
            result = await session.call_tool(
                "portfolio_overview", {"portfolio": slug, "positions": positions}
            )
        text = "\n".join(part.text for part in result.content if part.type == "text")
        if result.isError:
            raise RuntimeError(text)
        return text

    async def tools(
        self, token: str | None, slug: str | None = None, names: frozenset[str] = PORTFOLIO_TOOLS
    ) -> list[BaseTool]:
        async def pin(request: MCPToolCallRequest, handler: Handler) -> MCPToolCallResult:
            if request.name not in pinned:
                return await handler(request)
            return await handler(request.override(args={**request.args, PINNED: slug}))

        offered = [t for t in await self._client(token, pin).get_tools() if t.name in names]
        pinned = {tool.name for tool in offered if PINNED in _properties(tool)}
        if pinned and slug is None:
            offered = [tool for tool in offered if tool.name not in pinned]
        return [_unpinned(tool) if tool.name in pinned else tool for tool in offered]

    def _client(self, token: str | None, *interceptors) -> MultiServerMCPClient:
        connection: dict = {
            "transport": "streamable_http",
            "url": self._url if token else self._anonymous,
            "headers": {"authorization": token} if token else {},
        }
        if self._http is not None:
            connection["httpx_client_factory"] = self._http
        return MultiServerMCPClient(
            {SERVER: connection},  # type: ignore[dict-item]
            tool_interceptors=list(interceptors),
            handle_tool_errors=False,
        )


def _properties(tool: BaseTool) -> dict:
    schema = tool.args_schema
    return schema.get("properties", {}) if isinstance(schema, dict) else {}


def _unpinned(tool: BaseTool) -> BaseTool:
    schema = dict(tool.args_schema)  # type: ignore[arg-type]
    schema["properties"] = {k: v for k, v in _properties(tool).items() if k != PINNED}
    schema["required"] = [k for k in schema.get("required", []) if k != PINNED]
    return tool.model_copy(update={"args_schema": schema})
