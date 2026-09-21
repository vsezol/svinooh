# earn — where a token can be put to work

A catalog of single-token yield: **you deposit one asset, you are paid a rate**.
Solana and Kamino today; the shape is built for the second network and the
second protocol, not retrofitted for them.

The caller is the agent (`apps/agent`), which needs to answer "where can I earn
on my USDC" in one request and "what exactly is this pool" in the next — and,
once the user says yes, the transaction that puts the money there.

```
GET  /v1/lend/pools                      the list, narrowed by query parameters
GET  /v1/lend/pools/{pool_id}            one pool, everything about it
GET  /v1/lend/tokens                     what is earnable, best rate per token
GET  /v1/lend/coins?q=                   a coin by ticker or mint, to pay with or end as
GET  /v1/lend/positions?owner=           what a wallet has in pools, read from the chain
POST /v1/lend/pools/{pool_id}/deposit    the transaction that puts money in
POST /v1/lend/pools/{pool_id}/withdraw   the transaction that takes it out
POST /v1/lend/moves                      from a pool or a coin into a pool or a coin
GET  /v1/lend/deposits/{signature}       whether a signed transaction is on the chain
GET  /health                             is there a catalog to serve from
```

## The shape of the code

Four layers, and the dependency arrow only ever points inwards:

```
   api  ──▶  application  ──▶  domain  ◀──  infrastructure
   HTTP      use cases         the rules     Kamino, httpx, env
```

| package | what lives there | what it may import |
| :-- | :-- | :-- |
| `src/domain` | `Pool`, `Catalog`, `ListingPolicy`, `PoolSelection` | itself, `decimal.js` |
| `src/application` | the ports (`YieldSource`, `Clock`, `BuildDeposit`), the refresh loop, the use cases | domain |
| `src/infrastructure` | Kamino's API, mapping and deposit builder, the transaction, the HTTP client | domain, application |
| `src/api` | controllers, presenters, cursors, problem documents, parameter parsing | everything |

Two of those rules are worth spelling out, because they are what the
arrangement buys:

**The domain does not know it is a web service.** It imports no framework, no
HTTP client, no clock and no environment. So every rule in it — what counts as
listable, how a list is ordered, when an answer is stale — is exercised in a
unit test with nothing running.

**Ports are written from the inside.** `YieldSource` says what the application
needs, in the application's words; `KaminoSource` exists to satisfy it. A second
protocol is a new class in `infrastructure` and a line in the composition root,
and nothing else moves.

`test/layering.test.ts` walks the source and fails the build if an import points
the wrong way, so the arrow cannot rot into a comment. It also keeps the web
framework out of the two inner layers: the domain may not name Nest at all.

## What it reads

Kamino pays for a single-token deposit in two places, and both are here:

| kind | what it is | where it shows on kamino.com |
| :-- | :-- | :-- |
| `vault` | a curator (Steakhouse, Sentora, Allez) spreads your deposit across lending reserves; you hold a share token | Earn → Lend |
| `reserve` | you supply straight into one market's reserve and its borrowers pay you | Borrow → a reserve page |

Same product to a depositor, different accounts to sign, so they are one model
told apart by `kind`. Four calls to Kamino's public API build the whole thing —
no key, no RPC node, no wallet:

```
GET /kvaults/vaults                           the vaults and their on-chain state
GET /kvaults/vaults/metrics                   every vault's rates, 100 per page
GET /v2/kamino-market                         the 41 lending markets
GET /kamino-market/{market}/reserves/metrics  per market
```

Reserve metrics are read even when reserves are not published as pools of their
own: they are the only place a mint's ticker is written down, and a vault knows
its token by mint address alone.

## How it serves

**Requests never wait on Kamino.** `CatalogRefresher` rebuilds the whole catalog
every `EARN_REFRESH_INTERVAL_S` (default 5 min) and publishes an immutable
`Catalog`; a request reads a list already in memory. Three things follow:

- a cursor points into the catalog it was issued from, so paging a list sorted
  by APY does not show a pool twice because the rates moved;
- Kamino being down is not us being down — the last good catalog keeps
  answering and `meta.stale` says so;
- the number of calls we make to somebody else's free API depends on the clock,
  not on our traffic.

Startup waits for the first pass, but not forever (`EARN_STARTUP_GRACE_S`): a
healthy service is ready on the first healthcheck probe, and an unreachable
upstream cannot stop a deploy. Until there is a catalog, every read answers
**503 `not-ready`** — because "we could not read anything" and "there is nothing
to earn on" are opposite statements, and an empty list would be the wrong one.

## The wire contract

Every response is `{ "data": …, "meta": … }`.

```json
{
  "data": [
    {
      "id": "sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK",
      "network": "sol",
      "protocol": "kamino",
      "kind": "vault",
      "name": "Sentora PYUSD",
      "token": { "symbol": "PYUSD", "mint": "2b1kV6…", "decimals": 6 },
      "apy": { "net": "0.050794", "base": "0.025751", "rewards": "0.025042", "incentives": "0.000000" },
      "tvl_usd": "135323782.29",
      "url": "https://kamino.com/earn/lend/A2wsxh…"
    }
  ],
  "meta": {
    "as_of": "2026-09-10T10:33:28Z",
    "stale": false,
    "catalog": 1,
    "degraded": [],
    "count": 1,
    "total": 103,
    "next_cursor": "eyJ2IjoxLCJvIjoyMCwicSI6…"
  }
}
```

**Every number is a string.** A JSON number becomes an IEEE 754 double the
moment a client parses it. These are money and rates, upstream sends decimals of
thirty digits, and a rate wrong in the fourth place is a rate somebody quotes to
a user. Rounding is always *down*: the direction to be wrong in is the one that
does not promise more than exists. Rates are fractions — `0.0508` is 5.08% APY.

**`apy` is split, and `net` is the one to show.** Kamino's own UI has a toggle
for "include KMNO rewards in APY", so the halves are visibly different products:
`base` is what borrowers pay and keeps paying, `rewards` is a programme that
ends. `net` is their sum and matches the number on kamino.com.

**Every answer is timestamped.** `meta.as_of` is when the data was read,
`meta.stale` once that was longer ago than `EARN_STALE_AFTER_S`, and
`meta.degraded` names sources that could not be read at all. A rate with no time
on it is not a fact.

**Errors are RFC 9457 problem documents**, `application/problem+json`. A person
reads `title` and `detail`; a program branches on `type`, which is a stable URI:
`not-ready`, `not-found`, `coin-not-found`, `invalid-cursor`, `cursor-expired`,
`cursor-query-mismatch`, `invalid-parameter`, `deposit-not-supported`,
`amount-below-minimum`, `not-enough-held`, `deposit-would-fail`, `nothing-there`,
`move-not-supported`. The whole translation table is
`src/api/problems.ts`, and anything not in it surfaces as the 500 it is rather
than being flattened into a polite 400.

### Why the token is not in the path

The obvious URL is `/lend/{chain}/{token}/{pool}`, because that is how a person
describes the way to a pool. It is the wrong shape for one reason: **a path
segment is identity, a query parameter is a filter.** The vault is already
unique without its token, so putting the token in the path gives one resource
two URLs, one of which can contradict itself — what is
`/lend/sol/USDC/<a PYUSD vault>`, a 404 or a redirect? Every such question has
to be answered in code, forever. Filters go in the query string, where the next
one costs a parameter instead of a path level:

```
GET /v1/lend/pools?token=USDC&kind=vault&min_apy=0.05&sort=-tvl_usd&limit=20
```

`network` and `protocol` are filters for the same reason. `network` rather than
`chain` because this repo already means something else by `chain`: in
`libs/shared/src/index.d.ts` it is the family a wallet belongs to, and a pool
lives in a network — there is no pool on "EVM", it is on `base`.

### Why a cursor and not skip/limit

The list is sorted by a number that changes all day. With `skip=20`, a pool that
was 19th when the client read page one can be 21st when it asks for page two:
the client sees it twice and never sees whatever took its place. Offset paging
is correct only over data that does not move.

`meta.next_cursor` encodes the catalog version, the offset, and a fingerprint of
the selection. Change the filters and reuse the cursor and you get
`cursor-query-mismatch` rather than a quietly wrong page; come back after the
catalog has been rebuilt out of history and you get `cursor-expired` rather than
a page overlapping what you already read. Page size may change mid-read — it
does not change which list is being read, so it is not part of the fingerprint.

### What "listed" means

Kamino's API returns 178 vaults; its own UI shows about 30. The rest are test
and staging vaults and ones nobody ever funded, and there is no visibility flag
in the API — Kamino's frontend applies a minimum-shares check it does not
expose. So `ListingPolicy` is ours, and it is a judgement rather than a fact,
which is why it is a named object with its numbers injected:

- below `EARN_MIN_TVL_USD` (default $100k) a pool is not listed;
- a pool paying nothing is not listed — collateral-only reserves with borrowing
  switched off are real accounts you can really deposit into, and are not an
  answer to "where can I earn";
- names carrying `EARN_EXCLUDED_NAME_MARKS` are not listed.

The floor is $100k rather than $10k because a reserve holding $11k was showing
165% APY and therefore ranking first for "where can I earn USDC". The rate was
real — a nearly-empty reserve at full utilisation — and the recommendation was
still nonsense, because nobody can put money in at that rate.

**Unlisted is not unreachable.** `GET /v1/lend/pools/{id}` answers for every
pool, listed or not: somebody may hold shares in one, and 404 would be a lie
about the chain.

## Putting money in

Reading is most of this service. The one thing it does beyond reading is build
the transaction that puts money into a pool it lists.

```
POST /v1/lend/pools/sol:kamino:vault:A2wsxh…/deposit
{ "amount": "250", "owner": "EiN7zK…" }

{ "data": { "transaction": "AQAB…", "fee_payer": "EiN7zK…", "instructions": 9,
            "blockhash": "8Ld…", "last_valid_block_height": "367421008" },
  "meta": { "as_of": …, "catalog": 1, … } }
```

**Nothing here is signed and nothing is sent.** The answer is an unsigned v0
transaction, base64 in the wire format a wallet expects. The user's wallet signs
it and the wallet's own node broadcasts it; this service holds no key of theirs
and learns nothing about them beyond the address in the request.

**The node key stays on the server.** Building needs the chain — seven account
reads for a vault, nine for a reserve — and doing that from the browser would
put `SOLANA_RPC_URL` into the page source, a paid key with it. So the browser
asks `apps/api`, `apps/api` asks this service, and this service is the only one
that talks to the node. `SOLANA_RPC_URL` is the single setting here without the
`EARN_` prefix: it is the same name in every service that reads a chain.

**A protocol is a line in a record, not a hierarchy.**
`src/infrastructure/builders.ts` maps `sol:kamino` to the function that builds
it; the use case finds one or refuses by name. Meteora's vault SDK takes an
owner and a `BN`, its DLMM takes two token amounts, a position keypair and a
strategy — one interface over those would be invented rather than discovered, so
the routing is shared and the building is not.

**A signature is a question, not an answer.** A wallet comes back as soon as it
has sent the transaction, which is not the same as the transaction being on the
chain — and a deposit that runs out of funds fails *after* it was signed.
`GET /v1/lend/deposits/{signature}?network=sol` asks the node and answers
`pending`, `landed` or `failed`, with the slot it landed in and the chain's own
error when there is one. `meta.catalog` is null there: nothing in that answer
came from a catalog, so it answers while the first one is still loading.

**A move is from one place into another, whatever the tokens.** Each end of
`POST /v1/lend/moves` is a pool (`from`, `to`) or a coin in the wallet by its
mint or ticker (`from_coin`, `to_coin`): pool to pool, out of a pool as another
coin, a coin into a pool of another token, one coin for another. Where the
tokens differ it swaps on the way, through Kamino Swap's routes. What a pool
pays out is measured by simulating the withdrawal, never priced from the
shares. It is one transaction when that fits in 1232 bytes; when it does not,
the answer carries `then` — the next step, to be built and signed only once
this one has landed: out and swap now and the deposit after, or the
withdrawal alone and the swap from the wallet after. A coin is found first
among the catalog's own tokens, then among what the wallet holds, then among
the coins Jupiter's directory has verified: anybody can mint a token and call
it USDC.

**What the catalog knows is not asked for again.** The request carries the
amount and the owner. The program id, the vault or reserve address, the share
mint, the token program, the lending market and the minimum deposit come from
the pool as it stands in the catalog, and `meta.catalog` says which version that
was. Below the minimum, nothing is built at all: the refusal names the minimum.

## Running it

```bash
npm run -w apps/earn dev      # watch mode on PORT (3000 by default)
```

Two gates, both of which must be green:

```bash
npm run -w apps/earn test         # no network
npx tsc --noEmit -p apps/earn     # strict
```

The deposit builder is the one thing a unit test cannot prove, because what
makes it right is a program on mainnet accepting it. `npm run -w apps/earn
simulate:deposit` asks a running earn for a vault deposit and a reserve deposit,
checks the amount reaches the program in base units, and simulates both against
the chain.

The tests reach no socket. `test/fixtures/kamino.ts` holds recorded Kamino
payloads — kept verbatim in shape, thirty-digit decimals and scientific notation
included, because those are exactly what a naive parser gets wrong — behind a
`JsonTransport`, so the *real* `KaminoApi` and the *real* mapping are what runs.
The api tests boot the real application around that recorded source: nothing is
patched, and no test reaches into a private field.

Configuration is environment variables with an `EARN_` prefix, parsed in
`src/settings.ts` — a typo in a number fails at startup with a message rather
than silently falling back to a default nobody chose.

## What is deliberately not here

DDD is a set of tools, not a checklist, and the ones that would cost more than
they return were left out on purpose:

- **No repository abstraction.** A repository hides *storage*. There is no
  storage: the catalog is a tuple in memory, and `CatalogStore` is a small
  bounded ring, named for what it is.
- **No domain events, no CQRS buses, no unit of work.** Nothing here writes —
  not even the deposit endpoint, which hands back a transaction and forgets it.
  There is no state change to publish, and an event bus over that is ceremony
  that makes the call stack harder to follow and buys nothing back.
- **No value object around addresses.** `Rate` earns its wrapper because 5.08
  and 0.0508 look identical in a `Decimal`, and that confusion is the bug this
  service exists to not make. A base58 address has no such invariant — wrapping
  it would touch every field and catch nothing.
- **Signing, and sending.** Building the transaction is here; putting a
  signature on it is the user's wallet, and broadcasting it is that wallet's
  node. A service that could sign would need a key of the user's, and there is
  no version of this product where it has one.
- **Positions.** What a given wallet holds is the api's scan pipeline's job. This service
  knows about pools, not about people: the only address it ever sees is the one
  a deposit is being built for, and it needs no auth — `apps/api` is where a
  caller is one.
- **History.** Kamino serves `/kvaults/{vault}/metrics/history`; there is no
  reason to keep our own copy until something needs to query across protocols.
