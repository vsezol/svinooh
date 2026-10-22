# svinooh mcp

An MCP server (streamable HTTP, at `/mcp`) with a portfolio's reading tools:
the caller's portfolios, a portfolio's overview, its positions, what its money
is in, how its total moved, and exact arithmetic. It reads the portfolio's
public API with whatever `Authorization` header it is given and holds no
credentials of its own, so a caller sees exactly what they would see on
svinooh.com: their own private portfolios with a token, public ones without.

The model of a portfolio, the API client and the text the tools answer with
live in `libs/portfolio-py`, shared with `apps/agent`.

## Run it

```bash
uv sync
PORTFOLIO_API_URL=https://api-production-b486.up.railway.app uv run uvicorn main:app --port 3000
uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest -q
```

## Connect Claude Desktop

Claude Desktop reaches a remote server with a token through `mcp-remote`. In
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "svinooh": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://<mcp service domain>/mcp",
        "--header", "Authorization:${SVINOOH_AUTH}"
      ],
      "env": { "SVINOOH_AUTH": "Bearer <token>" }
    }
  }
}
```

The token is the svinooh session, `localStorage.svinooh_token` on svinooh.com
once signed in. It lasts 30 days.
