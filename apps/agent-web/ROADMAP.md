# The chat-first redesign, one step at a time

From the second Claude Design canvas (`Svinooh Agent v2.dc.html`, 5 artboards). Where
it disagrees with `DESIGN-SPEC.md` — which came from the first canvas, 14 artboards —
the v2 canvas wins and this file says so.

Each step is one MR, shippable on its own, and small enough to read in a sitting. The
order is not arbitrary: every step is either the smallest thing that makes the next one
possible, or the smallest thing that proves an idea before it is built on.

## What the redesign is

The assistant becomes the way into the product rather than a tab beside it. It answers
the question a portfolio page makes you go and look up, and it can reach the rest of the
app — and, later, your wallet — on your behalf. The portfolio is what it talks about.

Three rules run through all of it:

1. **The same component, not a picture of one.** A chart in an answer is the chart the
   portfolio draws, with the same gestures. A stat card is the stat card. If the
   assistant shows you something you cannot use, it has made a screenshot.
2. **Nothing on screen that did not happen.** A trace line exists because an operation
   ran and is reported by that operation. A widget exists because a tool was called.
   There is no layer that guesses what would look good here.
3. **One header, one strip, one set of tokens** — across the portfolio, the standalone
   chat and the embedded widget.

---

## Landed

| | what | why it came first |
| --- | --- | --- |
| [#147](https://github.com/vsezol/svinooh/pull/147) | One header, and it folds | Everything else sits on it, and there were two of them |
| [#148](https://github.com/vsezol/svinooh/pull/148) | The chat shows its work | The trace, the links, the typography — and the real step events behind them |
| [#151](https://github.com/vsezol/svinooh/pull/151) | The chart in a chat is the chart | Rule 1, made true for the first widget |
| [#178](https://github.com/vsezol/svinooh/pull/178) | The landing is the front door, and `/ai` is the app's home | Step 3, most of it — see what is left of it below |
| [#179](https://github.com/vsezol/svinooh/pull/179) | A conversation is kept, and it has an address | Step 3 parts 2 and 3 — the store the other three parts key on |

## Next

### 1. A tool call draws its own widget

**The problem it solves.** The renderer speaks a vocabulary the service has never used.
`schemas.py` emits exactly one block kind — `text`. Every stats grid, chart and table
you have seen is `demo/script.ts`. Nothing turns an answer into a widget today.

**The idea.** The model already decides *when* by deciding to call a tool.
`history_summary(period)` is the decision to show history. So the tool returns its text
to the model **and** emits a block to the reader, from the same result — the figures in
the card are the ones the model was handed, not a retelling of them.

**Smallest useful version.** One tool, one block: `history_summary` also emits the chart.
`run_tools` already wraps every call to report a step ([#148](https://github.com/vsezol/svinooh/pull/148));
the same wrapper carries the block.

**What it teaches.** How a tool result becomes a widget without a "decide what to draw"
layer — which is the layer that would start making things up.

### 2. The second tool, and the wire grows

`position_details(query)` emits the table. Nothing new is invented; the point is that
the pattern generalises and that a new block kind is additive on the wire.

**What it teaches.** Why the block vocabulary is versioned, and what "additively" buys.

### 3. Somebody with no account, and a conversation that outlives the tab

Three things that turn out to be one thing: onboarding without a sign-up, history that
survives a reload, and a URL per conversation. All three need the same missing piece —
a server that knows who is asking before it knows their name.

**What landed.** `/ai` is the app's home and answers without an account, the landing
hands it the first question, and `/ai/c/<id>` is a route
([#178](https://github.com/vsezol/svinooh/pull/178)).

Then the store underneath all of it ([#179](https://github.com/vsezol/svinooh/pull/179)).
A conversation is kept once, as its turns, in the agent's own Redis for thirty days from
its last one — and the context replayed into the model is a projection of those turns
rather than a second record beside them. `SessionStore` kept its interface and changed
what is behind it, so Postgres later is a swap. The rate limiter moved to the same Redis
in the same change, because in-process counting was not a smaller limit but the limit
multiplied by the replica count. `history.ts` is wire calls and its localStorage key is
retired. Every chat has its address from its first turn, `/ai` redirects to it, and
`/ai/c/<id>` reads from the server — so the same link opens the same conversation on a
phone, and somebody else's id is a 404 rather than a 403, because confirming one exists
is itself the thing being kept private.

**What is not true yet.**

*A visitor still cannot be onboarded.* Creating a portfolio needs a token
(`create_portfolio_with_wallets`), so a visitor who pastes an address is told to sign in
— where the landing's whole premise is that they should not have to.

*And the identity underneath it all is half-built.* The server seam is in place
(`app/owner.py`, and `agent-web/src/app/identity.ts` in the browser) because parts 2 and
3 could not key anything without one, but it was built beside part 1 rather than by it —
see below.

**The shape.**

1. **An anonymous identity.** A client-generated id, held in the browser and sent with
   every request, so the service can key on somebody before it knows their name. It is a
   soft identity by construction — clearing storage or opening a private window is a new
   person — so it is what history hangs on, not what a limit is enforced by. A limit
   wants an address behind it too.

   *Half done, and deliberately small.* #179 needed an owner key before this branch
   landed, so the seam exists: header `X-Svinooh-Anon-Id`, and one resolver turning a
   token and that header into `user:<id>` / `anon:<id>` / `sess:<id>`. It lives in two
   files of its own so this part can take it over rather than fight it in `auth.py`. The
   id is validated before it becomes part of a key, and the rate limit still charges
   every anonymous caller to one shared bucket — the id is too soft to meter with.
2. ~~**Durable history in the agent's own store**~~ — done in
   [#179](https://github.com/vsezol/svinooh/pull/179). Redis with its own `agent:` prefix,
   never the portfolio's database, so D1 holds. The one thing worth carrying forward: an
   owner's index is a ZSET with the *same* TTL as the chats in it, refreshed on every
   write, *and* reads prune the ids whose chat has gone. Either half alone leaves a list
   showing rows that resolve to nothing, and keyspace notifications cannot be the fix —
   they are at-most-once.
3. ~~**A URL per conversation, from the first turn.**~~ — done in
   [#179](https://github.com/vsezol/svinooh/pull/179). The stream's `start` event already
   named the conversation, so the address exists before the first answer finishes.
   Sharing stays a decision to make on the conversation rather than a link that happens
   to work — which is also what makes the canvas's "Saved · svinooh.com/ai/c/<id>" line
   buildable now: the storage can keep what it would promise.
4. **The agent creates a portfolio for a visitor.** With 1 in place, the anonymous POST
   the API already has (`POST /portfolios/anonymous` — ownerless, claimable later) can be
   what onboarding calls when there is no token, and a visit ends with a live portfolio
   instead of a sign-in wall.
5. **A free allowance, then the account.** Around five questions a session, then the
   answer is the sign-in card. Counted against the identity from 1 for the copy, and
   against something harder for the enforcement.

**What it teaches.** That "who is asking" is the load-bearing question under three
features that look unrelated, and the difference between an identity you can hang state
on and one you can enforce a limit with.

### 4. A cheap labelling model, verified this time

**The debt.** Labelling runs on the answering model — a large model doing a ten-token
job — because the cheap one we tried could not be routed to and failed silently for a
day ([#134](https://github.com/vsezol/svinooh/pull/134)–[#137](https://github.com/vsezol/svinooh/pull/137)).
That is about **4.6 of the ~5.5 seconds** before the first word of an answer appears.

**Why it is safe now.** The panel checks a model can call tools before it will save it
([#139](https://github.com/vsezol/svinooh/pull/139)), and an unreachable labelling model
falls back to the answering one instead of misrouting in silence
([#135](https://github.com/vsezol/svinooh/pull/135)).

**The shape.** Pick from the catalogue, change it in the panel, measure the same
questions, keep it or put it back — and write the numbers into the knob's help either
way, the way the provider-sort experiment did
([#146](https://github.com/vsezol/svinooh/pull/146)).

**What it teaches.** The panel as an instrument, and reporting a result that went the
other way.

### 5. The agent acts on your wallet

Artboard 05, and the largest step here — so it is three.

**5a. The card, in its five states.** `PROPOSED TRANSACTION` → `AWAITING SIGNATURE` →
`SUBMITTED` → `CONFIRMED`, plus the refusal. One card updating in place; the artboard
shows the states side by side. UI only, driven by a stub.

**5b. Connecting a wallet.** The real thing behind the stub. Read-only until a
transaction is proposed; svinooh has been watch-only until now, and this is the first
time it asks for a signature.

**5c. The model proposing one.** Gated the way portfolio creation already is: the model
can only ever *propose*, the execution happens on a later turn, and only after a
confirmation is read as a clear yes. No single model output can reach the signing path.

**What it teaches.** Human-in-the-loop for something that costs money, and why the gate
is structural rather than a line in a prompt.

### 6. The insight cards read the chain

**The debt.** The landing's yield card — a day of USDC lending replayed, four lenders
filling in proportion to what they hold — runs on figures that are typical rather than
measured (`apps/web/src/lib/yield-replay.ts`). Nothing in this app aggregates lending
markets: a position carries the APY its own protocol reports, and no one sums them. The
card carries no LIVE badge for that reason, and its heading states a count of lenders
that nothing counts.

**The shape.** A real source behind `replayFrame` — the same seam the card already reads
through, so the card does not change. Then the same source is a tool the agent can call,
which is what makes "where are the best LPs putting USDC?" — the question the landing
puts in a pill, right beside the card — an answer rather than a promise.

**What it teaches.** How an illustration on a marketing page becomes a data source the
product answers from, and that the honest version says which one it is.

### 7. The desktop, properly

Artboard 04: the sidebar with AI first, the history list, the shareable link. Today the
desktop is the mobile layout in a wider window.

---

## Deliberately not on this list

- **Multi-portfolio in one conversation.** The state has room for it; nobody has asked.
- **Voice.** No.
- **A block kind the model chooses freely.** That is rule 2 in reverse — the model would
  be picking a picture rather than doing something that has one.
