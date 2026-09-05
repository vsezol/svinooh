# Agent architecture: a standalone service and an embeddable widget

Status: draft for review · 2026-09-05 · builds on PRs #57–#60

## What this is

The agent started as a feature of the portfolio: a tab in the web app, a proxy
route in the api, a small service behind them (#57–#60). This document is the
map from that v0 to what the agent is actually meant to be: **a standalone
product that happens to be embedded in the portfolio** — its own service,
consuming the portfolio strictly through the public API, and its own widget
application, embedded into the web app as a microfrontend.

Two cuts, one rule each:

- **The service consumes APIs, never internals.** It reads the portfolio the
  way any third-party client would — over the public HTTP API, with the user's
  own token. No database access, no shared server libraries, no queue. Tomorrow
  it consumes other products' APIs the same way; the portfolio is the first
  DataSource, not a hard dependency.
- **The UI is its own application.** The chat is built, versioned and deployed
  separately, and the portfolio embeds it as a Module Federation remote.
  Separate audience, separate release cadence, separate marketing.

One property falls out for free: **privacy by construction**. The agent acts
with the user's own token, so it can never see more than that user can see —
the privacy rule holds at the transport level, not by policy.

## Where we are (v0)

On `main`: the tab UI is fully built behind `AGENT_ENABLED=false` — `AgentChat`,
the block widgets and the `Answerer` seam, answering from a local in-browser
stand-in (`agent-local.ts`).

Open: #57 the FastAPI + LangChain service (a pure LLM proxy, no data yet),
#58 the api gateway proxy `/ai/chat`, #59 the UI wiring + switch-on, #60 IaC.
They merge as v0. Nothing in them is thrown away below — the boundaries were
already in the right places; they deepen rather than move.

## Target

```
┌─ portfolio web (host) ──────────┐
│  agent-widget                   │      ┌──────────────────────────┐
│  MF remote · exposes mount()    │  ┌──▶│ portfolio public API     │
└───────────────┬─────────────────┘  │   │ DataSource #1 · today    │
                │ user's JWT         │   └──────────────────────────┘
                ▼                    │   ┌──────────────────────────┐
┌─────────────────────────────────┐  ├--▶│ other APIs               │
│  agent service                  │──┤   │ DataSource #2… · later   │
│  FastAPI · LangChain            │  │   └──────────────────────────┘
│  own public ingress             │  │   ┌──────────────────────────┐
└─────────────────────────────────┘  └──▶│ Claude API               │
                                         └──────────────────────────┘
```

The api-gateway proxy (#58) is a transitional layer: useful while the chat
lives inside the web app, deleted once the widget talks to the agent directly.

## Decisions

**D1 — The agent is an API client, not a platform tenant.** A `DataSource`
protocol inside the service; `PortfolioApiSource` is the first implementation,
calling `GET /portfolios/{slug}` and `/history` with the caller's token. No
`@svinooh/*` imports, no DATABASE_URL, no RabbitMQ — if the portfolio API can't
answer a question the agent needs answered, the fix is to extend the public
API, which makes the product API better for every client.

**D2 — Auth is the user's token, validated against the host.** The agent never
shares `JWT_SECRET`. It validates a caller by asking the host API
(`GET /auth/me` with the caller's token, cached ~60 s per token) and then
fetches data with that same token. Independence follows: any API that can
answer "whose token is this" can host the agent. So does privacy: the agent
holds no credentials of its own to leak.

**D3 — The wire contract is the block vocabulary.** `AgentBlock`
(text / stats / chart / table / bars / note) already defined in the web app is
promoted to the wire: `POST /chat` returns `{ "schema": 1, "blocks": [...] }`.
v1 returns a single text block; richer answers change the service, never the
seam. The widget renders blocks and knows nothing else.

**D4 — Module Federation, exposing `mount()`, not a React component.** The
widget bundles its own React and exposes one function:
`mount(el, { agentUrl, token, portfolioSlug, theme }) → { unmount }`. The host
loads it with the MF **runtime API** in a client component — the `nextjs-mf`
build plugin does not fit App Router/Turbopack, and build-time federation would
couple the two builds we are trying to separate. Because the exposed surface is
one function, the same bundle also loads from a plain script tag: MF is the
loader, not the architecture, and the fallback is one line.

**D5 — The gateway is transitional.** `/ai/chat` in the api exists so the
current in-app tab works before the widget does. Once M3 lands, the widget
calls the agent directly (CORS + token) and the proxy is deleted.

## Milestones — one small MR each

- **M0 — merge v0.** #57, #58, #60 now; #59 after the agent service is
  deployed with its key (that flag turns the live tab on).
- **M1 — real context.** `DataSource` protocol + `PortfolioApiSource`; the
  system prompt carries the portfolio the user is looking at. Fixes the honest
  gap in v0: today the opener chips get generic answers. Touches `apps/agent`
  only.
- **M2 — standalone ingress.** Public domain for the agent, CORS allowlist
  (the portfolio origin), token validation per D2, per-user rate limit, the
  blocks contract per D3. After this the agent no longer needs the gateway.
- **M3 — the widget.** `apps/agent-widget`: `AgentChat` + the block widgets
  move there; MF remote exposing `mount()`; the portfolio tab becomes a
  ~30-line embed host. The gateway proxy and `serviceAnswerer` are deleted.
- **M4 — the second DataSource.** Another API behind the same protocol —
  proves the multi-API claim with code rather than a diagram.

Later, and orthogonal: memory, tools, a LangGraph loop. All of it lives inside
the agent service; none of it moves these boundaries.

## Contracts (v1)

HTTP — the whole public surface of the agent:

```
POST /chat
Authorization: Bearer <user JWT>
{ "message": "...", "portfolio": "<slug>" }

200 { "schema": 1, "blocks": [ { "kind": "text", "text": "..." } ] }
401 unknown token · 429 rate limited · 400 empty message
GET /health → { "ok": true }
```

DataSource — the service-side seam new APIs implement:

```python
class DataSource(Protocol):
    async def portfolio(self, ref: str, token: str) -> Portfolio: ...
    async def history(self, ref: str, range_: str, token: str) -> Series: ...
```

Embed — the whole surface the host knows:

```ts
mount(el: HTMLElement, opts: {
  agentUrl: string; token: string;
  portfolioSlug: string; theme: 'dark' | 'light';
}): { unmount(): void }
```

## Risks

| Risk | Mitigation |
| --- | --- |
| MF × Next App Router/Turbopack | runtime-API loading + `mount()`; the same bundle loads from a script tag if the host bundler fights |
| token-validation latency | ~60 s cache per token hash |
| LLM cost / abuse | auth required, per-user rate limit, message length cap, model via `AGENT_MODEL` |
| the public API lacks data the agent needs | extend the public API — the agent is a client like any other, and its needs improve the product |
| widget ↔ service contract drift | `schema` field on the wire; this file is the contract's home |

## Non-goals (now)

- Memory, tools, multi-step graphs — roadmap inside the service, not
  architecture.
- Replacing the portfolio UI. The widget is embedded, not a takeover.
- A multi-tenant agent platform. One product, its own audience, first.
