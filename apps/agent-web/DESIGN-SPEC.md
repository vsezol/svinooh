# Agent frontend — design contract (from the Claude Design canvas, 14 artboards)

> **Superseded in places.** A second canvas (`Svinooh Agent v2.dc.html`, 5 artboards)
> made the product chat-first: the header folds, the agent's replies lose their identity
> row, the portfolio stops being the frame. Where the two disagree the v2 canvas wins —
> see `ROADMAP.md`, which tracks what has been brought across and what has not.

The canvas: `Svinooh Agent.dc.html` (14 artboards, one component set, svinooh tokens).
This file is the extracted, implementable contract: components, exact styles, layouts,
states. Implementers follow THIS, and reuse the kit classes/tokens wherever one exists.

## Non-negotiable layout rule (every artboard)

Strict column: `[log · flex:1 · overflow-y:auto · content anchored to the BOTTOM]`
+ `[composer · pinned]`. Height = `100dvh` minus host chrome, `padding-bottom:
env(safe-area-inset-bottom)`, input font 16px (iOS no-zoom). The page NEVER scrolls
behind the chat. Telegram in-app browser: viewport resizes on keyboard open/close —
the same rule handles it (artboards 02–03).

## Tokens (svinooh system — reuse, never redefine)

dark: --bg #08090c · --surf #0d0f14 · --surf2 #12151c · --line #1b1f28 ·
--line2 #262c38 · --text #edeff4 · --mut #9aa1af · --acc #2bd576 ·
--acc-soft (acc 13%) · --acc-ink #07130c · --up #2bd576 · --down #f6465d.
Light theme via `data-theme='light'` on html (host sets it; standalone must too).
Fonts: --sans Manrope, --mono IBM Plex Mono.

## Measured component specs (computed from the canvas, dark)

- **UserBubble**: align right, bg --acc-soft, radius 10px, pad 9px 12px,
  max-width ~85%, text 13px/700 sans --text.
- **AgentMessage**: NO bubble — a bare vertical stack of blocks, align left,
  gap ~10px, small "agent" avatar dot optional per canvas header treatment.
- **Card (stats/chart/table)**: bg --surf2, 1px --line, radius 12px, pad 12px 14px
  (table pad 0 — rows carry their own padding).
- **Interactive card (Confirm / SignIn)**: same but border --line2 (stronger),
  signin pad 16px, confirm sectioned: header strip, address rows `pad 9px 16px`
  with `gap 10px`, footer `pad 12px 16px 14px`.
- **Buttons**: pill radius 999px, height 40px. Primary: bg --acc, text --acc-ink,
  13px/800 sans, pad 0 18px. Secondary: transparent, 1px --line2, text --mut,
  13px/700, pad 0 16px.
- **Composer**: pill bar radius 24px, bg --surf, 1px --line2, pad 5px 5px 5px 16px,
  gap 8px; input 16px/400 sans (placeholder --mut); round send button (--acc).
- **OpenerChip**: pill, 1px --line2, pad 7px 12px, 13px sans.
- **Labels/eyebrows** (TOTAL VALUE, PROPOSED ACTION, HISTORY, GROUNDED IN):
  9.5px/400 mono uppercase --mut, letter-spacing wide.
- **Stat value**: 19px/600 mono --text; sub-line 10.5–11px mono (+ green / − red).
- **SystemNote / Block.Note / StatusLine / Unsupported**: centered or inline
  11–11.5px mono --mut. StatusLine is transient with a subtle pulse.
- **Addresses**: always shortened `0x7bfee9…c060`, 13px/500 mono; chain shown via
  the kit's ChainBadge + tiny label; refused reason 10.5px mono --down.
- **History item**: title 13px/700 sans --text + relative date 10.5px mono --mut;
  active item bg --acc-soft (see screenshot), radius ~8px.
- **GroundingChip**: pill with portfolio name 12.5px/700 + chevron; opens switcher.
- **Pro card**: bg --surf, 1px --line2, radius 16px, pad 22px; CTA = primary pill
  "Go Pro — $5 today", sub "THEN $10 / MONTH · CRYPTO · NO AUTO-RENEW" (9.5px mono).
- **Chart**: svg area+line, --acc line, soft gradient fill, mono axis labels
  (values right, dates bottom), delta headline `+$7,522` in --up.
- **Bars**: per row — name (13px sans) + value (12.5px/600 mono) on one line,
  bar track --line with --acc fill, sub-line 10.5px mono --mut
  ("61% · Ethereum, Arbitrum, Base · 2 wallets").
- **Table**: head row 9.5px mono uppercase --mut, body 12.5–13px mono, row
  dividers 1px --line; on 375 collapse to 3 columns (drop BORROWED/LIQ. PRICE —
  same discipline as the portfolio tables); negative values --down, health --text.

## Screens / hosts

1. **Standalone (ai.svinooh.com)** — header: svinooh logo + `AGENT` pill (--acc-soft,
   9px mono) + right side: theme toggle, account icon or "Sign in". Desktop ≥1024:
   left history rail 250px (pad 22, gap 14: "New chat" primary-ghost button, HISTORY
   eyebrow, items). Mobile: history = bottom sheet (artboard 13), opened from a
   header icon. Chat column max ~720px centered.
2. **Embedded tab (svinooh.com)** — mounts inside the existing AI tab under the
   portfolio header; no own logo header. Top bar inside chat: GroundingChip +
   (desktop) New chat / History buttons; 1280: sidebar "PORTFOLIO AGENT · BETA"
   panel with the same rail (artboard 08); 768: compact sidebar (10).
3. **Signed-out door (04/05)** — centered: logo, headline "Ask anything about your
   wallets.", sub copy, 3 feature rows (icon + line), buttons Continue with
   Telegram / Continue with X, composer enabled for general questions
   ("Ask about DeFi…").
4. **Empty grounded (06)** — centered: "Ask about Main portfolio" headline,
   "4 WALLETS · $131,902 · SYNCED 2 MIN AGO" (mono eyebrow), 4 opener chips.
5. **No portfolio yet (11)** — headline "No portfolio yet.", copy inviting to paste
   addresses, example address pills, "ONE PER LINE OR COMMA-SEPARATED" eyebrow,
   composer placeholder "Paste wallet addresses…".
6. **Pro-locked (12)** — the log stays visible; composer replaced by the Pro card;
   a small "PRO FEATURE" eyebrow above.
7. **Sheets (13/14)** — bottom sheets on mobile for History and Switcher: rounded
   top, drag notch, same content as rail/popover. Switcher rows: name + `$total ·
   N wallets` (mono sub), check on the grounded one, "New portfolio" row last.

## Block vocabulary (wire `kind` → component)

text · stats (2–4 cards grid; 2-col on 375) · chart · table · bars · note ·
signin (title, sub, Telegram/X buttons, "AFTER SIGN-IN I'LL ANSWER · <question>"
eyebrow) · confirm (states: pending → buttons Create portfolio / Cancel +
"Nothing is created yet."; created → CREATED eyebrow, per-address added /
refused rows, "N added · M refused" mono sub, "Open portfolio" link, portfolio
name; declined → single quiet line "Okay — nothing was created.") ·
unsupported → `[unsupported: <kind>]` note.

## Failure notes (SystemNote)

"Session expired." (+ SignIn block follows) · "Rate limited — retry in Ns." with a
Retry ghost button · "The agent is unavailable right now. Your question is saved."
· degraded: "Live numbers unavailable right now — answering generally."

## Statuses

StatusLine ("Searching positions…", "Reading APYs…") — transient mono lines that
replace each other; ThinkingPulse — "Thinking" with pulse animation.
