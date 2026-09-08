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

### 3. A chat has a URL

`/ai` and `/ai/c/<id>`. The chat becomes the app's home, a conversation can be linked,
and returning to one is a navigation rather than a tab you happened to leave open.
Artboard 04 shows the link in the desktop sidebar.

**What it teaches.** Routing state that is worth putting in a URL, and what happens to
the swipeable pager when tabs become routes.

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

### 6. The desktop, properly

Artboard 04: the sidebar with AI first, the history list, the shareable link. Today the
desktop is the mobile layout in a wider window.

---

## Deliberately not on this list

- **Multi-portfolio in one conversation.** The state has room for it; nobody has asked.
- **Voice.** No.
- **A block kind the model chooses freely.** That is rule 2 in reverse — the model would
  be picking a picture rather than doing something that has one.
