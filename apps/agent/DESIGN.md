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
│  agent-web                      │      ┌──────────────────────────┐
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

The vocabulary is designed to grow, and not only with charts: the first
*interactive* block is `signin`. When a turn needs an identity the caller does
not have (the onboarding branch's signed-out case), the service answers with a
`signin` block; the host renders the product's own auth UI inline in the chat
flow — the same Telegram/Twitter options the header modal uses, but scrolling
as a message. The block carries the pending question, and when the auth flow
completes the chat re-asks it with the fresh token, so signing in continues
the conversation instead of restarting it.

**D4 — Module Federation, exposing `mount()`, not a React component.** The
widget is built with the same stack as the product front — React 19 — as a
webpack Module Federation remote: name `svinooh_agent`, exposing `./mount`,
with react/react-dom shared as singletons so host and remote run one React.
The Turbopack host consumes it with the MF **runtime API** in a client
component — build-plugin federation does not exist for App Router/Turbopack.
The UI kit lives in `@svinooh/ui` (libs/ui): the shell imports it at build
time, remotes share it as an MF singleton — one source of truth either way.
And because the same remoteEntry also registers a window global, a plain
script tag remains the fallback loader: MF is the loader, not the
architecture.

**D5 — The gateway is transitional.** `/ai/chat` in the api exists so the
current in-app tab works before the widget does. Once M3 lands, the widget
calls the agent directly (CORS + token) and the proxy is deleted.

**D6 — One identity, two doors.** The agent never implements login providers.
Embedded in svinooh.com, the shell hands the user's token in through `mount()`;
as a standalone app, the agent shows its own sign-in screen that drives the
host product's auth flows (Telegram today, Twitter when the product grows it)
and receives the same JWT. Either way the token is the identity, and
`GET /auth/me` is the oracle: one call answers both "whose token is this" and
"which portfolios do they own" (`MeDto.portfolios`). The agent stores no
credentials and mints none.

**D7 — Conversation routing, as a graph.** Not every question needs portfolio
data, and fetching it for "what is a health factor" wastes a round trip and
tokens. A cheap classifier (structured output on the configured model) names
the intent — `portfolio` vs `general` to start — and a LangGraph `StateGraph`
with conditional edges runs the branch: general → answer; portfolio → resolve
whose portfolio (D6) → analyze it, or hand off to onboarding (D8) when there is
none. v1 was a straight line and needed no graph; branching plus shared state
plus, later, interrupts for confirmation is exactly what LangGraph is for — it
arrives when the shape of the problem becomes a graph, not before. New
classifiers ship in shadow mode first: classify, log, change nothing — then
route once the labels look right.

**D8 — Onboarding is the agent's first write, and writes are confirmed.** A
user with no portfolio who asks about "my portfolio" is offered one: the agent
collects wallet addresses in the conversation, then creates the portfolio
through the same public API as any client (`POST /portfolios`,
`POST /portfolios/{slug}/wallets`) — with the user's token, so it lands owned
by them. Reads are silent; a write happens only after the user explicitly
confirms it in the chat. That rule outlives onboarding: every future action the
agent can take follows it.

## Milestones — one small MR each, one lesson each

Deliberately over-split: each step is a reviewable MR that teaches exactly one
agent-engineering concept and leaves the system working.

- **M0 — merge v0.** #57, #58, #60 now; #59 after the agent service is
  deployed with its key (that flag turns the live tab on).
- **M1 — real context** (#102). `DataSource` + `PortfolioApiSource`; answers
  grounded in the portfolio on screen. *Lesson: API-as-context, honest
  degradation.*

The routing ladder (D7/D8) — each step builds on the previous:

- **R1 — the shadow router.** An intent classifier as its own module:
  structured output (`{intent: portfolio | general}`) on the same model, wired
  in shadow mode — every turn is classified and logged, nothing changes
  behavior. *Lesson: structured outputs, and shipping classifiers dark before
  trusting them.*
- **R2 — the graph.** LangGraph `StateGraph`: classify → conditional edge →
  `general` (plain answer) | `portfolio` (today's context flow). The shadow
  label starts steering. *Lesson: nodes, state, conditional edges — the graph
  arrives exactly when the shape demands it.*
- **R3 — whose portfolio.** The portfolio branch resolves identity via
  `GET /auth/me` (D6): owns portfolios → ground in them (the widget's slug
  stays a hint, not a requirement); owns none → route to onboarding. *Lesson:
  identity as data in the graph state.*
- **R4 — onboarding, the first write.** The no-portfolio branch collects
  wallet addresses across turns and, after explicit confirmation, creates the
  portfolio via `POST /portfolios` + `POST /{slug}/wallets` with the user's
  token. *Lesson: agent actions, human-in-the-loop confirmation, multi-turn
  state.*

- **T1 — drill-down tools: the agentic loop.** The grounded branch binds two
  read-only tools — a history summary over a model-chosen period, a position
  search past the context cap — and loops: the model calls, the service
  executes, the result returns as a message, until the model answers (capped
  hops; tool errors return to the model as text). Python computes the numbers
  from the full series; the model narrates five computed lines. *Lesson: the
  agentic loop; tools with bodies; context injected by closure — the model
  chooses arguments, never identity.*
- **E1 — where to put it.** A third intent, `earn`, and a branch of its own:
  the catalog service (`apps/earn`) behind a port, one tool over it, and a
  recommendation made by RISK before rate. The band is computed here rather
  than read from the catalog — the catalog owns facts, a judgement about them
  is ours — and it is printed with the reasons that produced it, so an answer
  can say why one option is safer instead of asserting that it is. A visitor
  gets the catalog with no identity asked for; a caller we can read is also
  shown what they ALREADY earn, so the recommendation can be a move rather
  than only a new deposit. *Lesson: a second neighbour costs a port, an
  adapter and a node; opinions live where they can be argued with.*
- **E2 — asked, or told.** "Where can I put USDC" and "put my USDC to work"
  are the same branch and not the same turn. The classifier already runs once
  per turn, so it carries the difference as a second field rather than a
  second call, and the node picks the closing from it: a question is answered
  and then closed with the offer to do it, a request names one pool and asks
  for what is still missing. The words stay in the prompt because the answer
  is in the user's language; the choice of which words stays in code because
  a closing left to the model is a closing it forgets. *Lesson: decide in
  code, word it in the prompt.*

Then the independence milestones, unchanged in substance:

- **M2a — the lock.** Token validation per D2 (the host asked, cached briefly,
  401 only on outright rejection — an auth outage demotes to anonymous, safe
  because enforcement stays with the host API on every call) and a per-caller
  rate limit (the cost lock: every turn is paid model calls). *Lesson: auth at
  the edge without shared secrets; fail-open vs fail-closed, chosen per case.*
- **M2b — the wire and the door.** The blocks contract per D3 on the wire
  (expand-then-contract: `blocks` added, `reply` kept for the transitional
  gateway), CORS allowlist, public domain. The gateway becomes unnecessary.
- **M3a — the widget application.** `apps/agent-web`: React 19, a webpack
  Module Federation remote exposing one `mount()` (D4), with the full design
  implemented — every block of the vocabulary, the standalone and embedded
  shells, and a `/demo` kitchen sink rendering all of it from canned data.
  The agent service serves the build at `/widget` (and the standalone page
  at `/`) — same origin as the wire it speaks, no extra service to run. It
  calls the agent directly through the M2 door, renders blocks, refuses a
  wire schema it does not speak, and fails honest — 401, 429 and network
  each get their own note. *Lesson: a microfrontend is a contract — one
  function in, one build out.*
- **M3b — the host embeds it.** The portfolio tab becomes a ~30-line embed
  host: load the bundle, `mount()` with the shell's token (the embedded door
  of D6 — the JWT lives in the web app's localStorage, so the shell can hand
  it over), slug and theme. `AGENT_ENABLED` flips on; the `agent-local.ts`
  stand-in retires; #58 and #59 close unmerged — the direct wire landed
  before the transitional gateway path was ever needed. *Lesson: the shell
  owns identity; the widget owns the conversation.*
- **W1 — the sign-in block.** The first interactive block (D3): the service
  answers a signed-out portfolio question with a `signin` block, the host
  renders its auth UI inline in the chat, and the pending question is re-asked
  once the flow completes. Needs blocks on the wire (M2) and reuses the host's
  existing auth modal. *Lesson: interactive blocks — the chat as a surface for
  UI, not only prose.*
- **S1 — the standalone door.** The agent app's own sign-in screen, driving
  the host's auth flows (D6). The agent becomes visitable on its own domain.
- **M4 — the second DataSource.** Another API behind the same protocol —
  proves the multi-API claim with code.

Still later, and orthogonal: durable chat history in the agent's own store
(after M2, when validation names the user), richer tools, deeper graphs. All
inside the service; none of it moves these boundaries.

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
  agentUrl: string; token?: string;
  portfolioSlug?: string; portfolios?: PortfolioRef[];
  theme?: 'dark' | 'light'; locked?: boolean;
  variant?: 'embedded' | 'standalone'; signedIn?: boolean;
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
