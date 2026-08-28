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

This project uses **bd** (beads) for issue tracking, and bd is **local only**.

`.beads/` is gitignored and nothing in it is ever committed — see the note in
`.gitignore` for why. That means: never `git add .beads`, never run `bd sync`,
never `git add -A` from the repo root without checking what it swept up, and
never take a merge conflict in `.beads/` as something to resolve rather than
something that should not exist. The tracker is a scratchpad for the session,
not a shared artefact; anything that has to outlive the session goes in a
commit message, a PR, or the code.

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>           # Complete work
```

### The hook that enforces it

`.gitignore` was not enough. `bd` force-adds its own files and commits them
itself — which is how `.beads/backup/*` reached main *after* the commit that
took beads out of git for good, and then rode into unrelated branches, because a
worktree branched off a local checkout inherits whatever `bd` had just committed
there. It also points `core.hooksPath` at its own directory, per worktree, which
quietly disables every other hook in that worktree.

The whole history has since been rewritten to remove `.beads` from every commit
on every branch. `.githooks/pre-commit` is what stops that being needed twice: it
refuses any commit whose index contains a `.beads/` path. Enable it once per
clone, and check that nothing has taken the setting over:

```bash
git config core.hooksPath .githooks
git config --show-origin --get-all core.hooksPath   # expect exactly one line
```

A second line pointing into `.beads/hooks` is `bd` having claimed the hooks —
`git config --worktree --unset core.hooksPath` gives them back.

Types: `bug`, `feature`, `task`, `epic`, `chore`. Priorities run `0` (critical)
to `4` (backlog), and `2` is the default. Add `--json` when reading the output
programmatically, and link work you find along the way with
`--deps discovered-from:<parent-id>`.

Do not keep a second tracker beside it: no markdown TODO lists, no task files.

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

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
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

