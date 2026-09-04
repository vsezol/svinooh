# Daily strategy drift check

The prompt below is the whole routine. Hand it to `claude -p` on a schedule.

Run it **from a residential connection**, not from CI. The browser strategy
scrapes debank.com, and DeBank rate-limits datacenter IPs hard — from Railway it
returns partial pages, from a home connection it does not. A GitHub Actions
runner would report drift every day and all of it would be DeBank throttling.

    # ~/Library/LaunchAgents/com.svinooh.drift.plist, or crontab:
    17 10 * * *  cd /path/to/svinooh && claude -p "$(cat ops/strategy-drift-check.md | sed -n '/^---$/,$p')" >> /tmp/svinooh-drift.log 2>&1

---
You are checking whether svinooh's two EVM scan strategies still agree. Work in
the repository you were started in.

**Setup**

1. `git fetch origin main && git checkout main && git pull` — check the current
   code, not whatever was last left in the tree.
2. `apps/scanner-evm/.env` must have `ZERION_API_KEY` and `SCANNER_ENGINE=chrome`.
   If the key is missing, STOP and say so. Without it the api strategy silently
   falls back to the browser one and the test passes by comparing DeBank with
   itself — a green run that means nothing is worse than a red one.

**Run**

3. `npm run -w @svinooh/scanner-evm test:strategies`

**If every wallet passes**

4. Report one line per wallet — browser total, api total, gap, tolerance — and
   stop. Change nothing. Open nothing.

**If the run itself failed**

5. A timeout, a 5xx, a browser that would not start, or a `browser` reading
   absurdly below the wallet's known size are NOT drift. They are the check
   failing to run, and DeBank throttling is the usual cause. Say which wallets
   could not be read and stop. Do not propose changes on a broken run.

**If a wallet's two readings have genuinely moved apart**

6. `npm run -w @svinooh/scanner-evm diff -- <that address>`

7. Classify by the SHAPE of the diff — the header of `apps/scanner-evm/test/diff.ts`
   describes all three, and the shape is the diagnosis:

   - **Mirrored rows** — a value on one side, `$0` on the other, and another row
     with the mirror image and a similar figure. One protocol under two names
     (`LISTA DAO` / `HELIO`, `PENDLE V2` / `PENDLE`). Nothing is missing.
     Proposed fix: teach the api adapter the alias. Do NOT add a provider —
     adding one here double-counts the money.

   - **Value under `browser`, nothing anywhere under `api`** — a venue the api
     strategy does not cover, the way Hyperliquid was. Before proposing a
     `GapProvider`: find whether that venue has a public API, call it for the
     failing address, and check its figure against what `browser` reported. Only
     propose the provider if those two agree. A provider that adds a wrong
     number is worse than a missing one, because it reads high.

   - **Many small rows differing in both directions** — the two price illiquid
     tokens differently and neither is right. Not fixable in our code.

8. Report: which wallet, the measured gap against its recorded tolerance, the
   diff output, which of the three shapes it is, and the concrete change you
   propose — a file and an edit, not a direction.

**The rule that keeps this honest**

9. Widening a tolerance in `apps/scanner-evm/test/wallets.ts` is the LAST resort
   and is only ever right for the illiquid-pricing case. A test that is loosened
   every time it goes red has stopped being a test. If you do propose widening
   one, say by how much, why the old figure no longer holds, and what you ruled
   out first.

10. Never commit, never push, never open a PR. Report and propose; the decision
    is the owner's.
