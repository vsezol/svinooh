# svinooh mcp

An MCP server (streamable HTTP) with a portfolio's reading tools: the caller's
portfolios, a portfolio's overview, its positions, what its money is in, how
its total moved, the best lending rates, and exact arithmetic. A wallet address
works wherever a portfolio does. It also serves scenarios (prompts) and a
portfolio as a resource: any portfolio by `svinooh://portfolio/{id}` (and
`…/assets`), and the caller's own listed, so a client can offer them to attach.

Every request from the internet signs in. `/mcp` is signed in with svinooh
over OAuth: a client that arrives without a token is answered 401 with where
to get one, registers itself, and sends the person to `svinooh.com/connect` to
allow it. The server then reads with that person's svinooh session, private
portfolios included. A svinooh session token sent as `Authorization: Bearer …`
also works, for clients set up by hand.

The same tools reading as nobody are served on a second port,
`MCP_ANONYMOUS_PORT` (3001), which no public domain routes to: only the agent,
over Railway's private network, reaches it, to answer visitors who are not
signed in.

The model of a portfolio, the API client and the text the tools answer with
live in `libs/portfolio-py`, shared with `apps/agent`.

## Run it

```bash
uv sync
PORTFOLIO_API_URL=https://api-production-b486.up.railway.app EARN_API_URL=<earn service> \
  uv run python main.py
uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest -q
```

| variable | what |
| :-- | :-- |
| `PORTFOLIO_API_URL`, `EARN_API_URL` | the APIs it reads |
| `MCP_PUBLIC_URL` | its own public origin: the OAuth issuer, and `/mcp` under it is the resource |
| `WEB_URL` | where the consent page is, and the only origin its calls are open to |
| `REDIS_URL` | registered clients (90 days from their last connection), pending requests and issued tokens; without it they live in the process |
| `PORT`, `MCP_ANONYMOUS_PORT` | the signed-in port the public domain routes to (3000), and the private one (3001) |

## Connect Claude

In Claude (web or Desktop), Settings → Connectors → Add custom connector, with
the URL `https://mcp-production-fb28.up.railway.app/mcp`. Claude opens
svinooh.com to sign in and allow it; nothing to paste.

Clients that cannot do OAuth can still be configured by hand with `mcp-remote`
and the svinooh session (`localStorage.svinooh_token` on svinooh.com, 30 days):

```json
{
  "mcpServers": {
    "svinooh": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://mcp-production-fb28.up.railway.app/mcp",
        "--header", "Authorization:${SVINOOH_AUTH}"
      ],
      "env": { "SVINOOH_AUTH": "Bearer <token>" }
    }
  }
}
```

Only clients that send the person back to `claude.ai`, `claude.com` or this
machine (`localhost`) may register; any other redirect is refused, so a link
built to borrow somebody's account cannot be made to look like a real request.
