# Agent Instructions

## 🔒 Project rule #1 — user privacy is non-negotiable

Svinooh shows how much money people hold. Tying that to a person is a
deanonymization risk with real-world consequences, so **anything that identifies
a user is visible to that user alone — never to anyone else, anywhere.**

Hard rules. They outrank convenience, design and "it's just a small label":

- **Never render a user's handle, name or photo to anyone but that user.** Not on
  the landing page, not in a leaderboard, not on a portfolio page, not in an OG
  image, not in a page title, not in an error message. A public portfolio shows
  its balances — never who owns it.
- **Wallet labels belong to the owner only.** A label is user-written text ("Main
  Ledger", "Wife's cold wallet") and leaks intent and identity. Non-owners get
  the network default name.
- **Auto-generated names must not embed identity.** No `@handle`'s portfolio, no
  first names. If a default name needs to be public, it must be derivable from
  public chain data (an address) or be generic.
- **Private by default.** A portfolio someone creates from their account starts
  private: absent from the landing and from search, reachable only by its link.
  Going public is an explicit, confirmed action by the owner.
- **When adding any field to a public response, ask who can see it.** Default to
  not returning it unless the request is authenticated as the owner. Don't return
  the data and hide it in the frontend — that's still a leak over the API.

### The data model this rests on

A `Portfolio` is a standalone thing: a group of wallets with a slug. Who owns it
and whether it is public live in a separate table, `PortfolioOwner`:

- **No owner row → an anonymous portfolio.** Created when someone searches for a
  wallet on the landing. It belongs to nobody, is inherently public and
  searchable, and carries no user data at all.
- **An owner row → someone's portfolio.** `isPublic` defaults to `false`.
  Visibility is a property of the *ownership*, not of the portfolio, because an
  ownerless portfolio has no one to be private from.

## Naming

One shape for every name, so nothing has to be looked up twice.

**Services, directories and packages: lowercase kebab-case, role first.**

```
apps/api           @svinooh/api           railway: api
apps/auth          @svinooh/auth          railway: auth
apps/wallet        @svinooh/wallet        railway: wallet
apps/web           @svinooh/web           railway: web
apps/scanner-evm   @svinooh/scanner-evm   railway: scanner-evm
libs/common        @svinooh/common
```

The directory, the npm name and the Railway service are the **same string** —
if you know one you know the others. Never capitalised, never camelCase, never a
suffix describing where it came from (`grafana-repo`).

A qualifier goes after the role, not before: `scanner-evm`, not `evm-scanner`.
Roles group together in an alphabetical list, which is how you actually read a
service list once there is more than one of a kind.

**Queues: `scan.<chain>`** — lowercase, dot-namespaced, the chain exactly as the
`Chain` enum spells it in lower case: `scan.evm`, `scan.sol`, `scan.tron`,
`scan.btc`.

**Environment variables: SCREAMING_SNAKE_CASE**, named for what they configure
and not for the service reading them: `SYNC_INTERVAL_MIN`, `RABBITMQ_URL`,
`CHROME_NO_SANDBOX`. A variable two services both read has one name in both.

Two Railway services are off-convention and can only be renamed from the
dashboard (the API has no field for it): `Postgres` and `Redis` are Railway's
own defaults, and renaming them rewrites every `${{Postgres.DATABASE_URL}}`
reference — worth doing deliberately, not in passing. `grafana-repo` is free to
rename, nothing references it.

## Issue tracking

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs with git:

- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- END BEADS INTEGRATION -->
