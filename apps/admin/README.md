# admin

The operator's panel. Its own service, its own domain, one password.

It is **not** part of the public site and must not become reachable from it: it
can change how hard the whole system pushes, and it sits on a database where a
balance and the person holding it are one join apart.

## What it does

One page — **Throughput** — generated from `libs/common/settings/registry.json`,
which is the same file the Node services read. A knob added there appears here
with its bounds and its unit, and in the services with its default, and there is
no second copy to keep in step.

A value resolves **database → environment → declared default**. So:

- an empty `Setting` table is a system running exactly as it shipped;
- a row is a decision somebody made, and the table reads as a list of them;
- `SYNC_INTERVAL_MIN` and friends still work for local development;
- saving a knob back to its default deletes the row rather than storing it.

Changes are picked up by the running services within 15 seconds. Two knobs are
marked **needs redeploy** — the scanner has no database and cannot be told.

The page refuses a set of values that does not hold together, not just one out
of range. A scan-claim lease shorter than the scan it is leasing is a valid
integer and a broken system; that check lives in the registry as a rule, so both
stacks can make it.

## Running it

```bash
cd apps/admin
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
DATABASE_URL=postgresql://svinooh:svinooh@localhost:5432/svinooh \
ADMIN_USER=you ADMIN_PASSWORD_HASH="$(.venv/bin/python -m app.hash)" \
ADMIN_SESSION_SECRET=$(openssl rand -hex 32) \
.venv/bin/uvicorn app.main:app --port 3010
```

Then http://localhost:3010/admin.

## Environment

| variable | what it is |
| --- | --- |
| `DATABASE_URL` | the same Postgres the services use. Prisma owns the schema; this only reads and writes `Setting`. |
| `ADMIN_USER` | the one account. Defaults to `admin`. |
| `ADMIN_PASSWORD_HASH` | from `python -m app.hash`. Preferred. |
| `ADMIN_PASSWORD` | plaintext, accepted but logged as a warning on every start. |
| `ADMIN_SESSION_SECRET` | signs the session cookie. Unset means a new one per restart, which signs everybody out. |

With neither password variable set, nobody can sign in — which is the right
behaviour for a service that has been deployed before it was configured.

## Deployment

Railway deprecated config-as-code, so there is no `railway.json` here — the
service carries its own configuration: Dockerfile `apps/admin/Dockerfile`,
healthcheck `/health`, restart on failure, and watch patterns `apps/admin/**`
and `libs/common/settings/**`, so it only rebuilds when its own files or the
registry change.

It has no public domain by default. Give it one only when you need it from
outside, and set `ADMIN_PASSWORD_HASH` first — with no password set the panel
refuses every sign-in, which is the right behaviour but not one to rely on as
your only lock.
