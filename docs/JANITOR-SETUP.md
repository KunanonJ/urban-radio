# R2 orphan janitor setup

Periodic sweep that deletes object-storage files no longer referenced by any
database row — the recovery path for pentest **M-07** (compensating storage
deletes are fire-and-forget, so a failed delete leaves a permanent orphan).

**Script:** `scripts/janitor-r2-orphans.mjs` · **Command:** `npm run janitor:r2`
**Status today:** dry-run only by default; deletes nothing until you pass `JANITOR_APPLY=1` AND R2 creds are set.

---

## 1. Why orphans accumulate

Two code paths intentionally swallow storage-delete failures so a hiccup in R2
never aborts the user-facing operation:

- `src/app/api/voice-tracks/[id]/route-impl.ts` — after the DB row is deleted
  (pentest L-01 reordered this DB-first), the audio object is deleted
  best-effort; a thrown error is logged-and-scrubbed, not retried.
- `src/app/api/upload/route-impl.ts` — a failed compensating delete after a DB
  write error is swallowed.

Each swallowed failure orphans one R2 object. Over months these add up to real
storage cost and a fuzzier "what's actually in the bucket" picture. The janitor
reconciles bucket ⇄ DB and reclaims the orphans safely.

---

## 2. How it works

1. **List** every object in `STORAGE_BUCKET` (`ListObjectsV2`, paginated).
   Keys come from two producers: `uploads/<id>/<name>` (upload route) and
   `stations/<stationId>/voice-tracks/<id>.<ext>` (voice-track create).
2. **Build the referenced-key set** by unioning four DB columns:
   - `SELECT media_r2_key FROM tracks`
   - `SELECT storage_key FROM radio_tracks`
   - `SELECT storage_key FROM voice_tracks`
   - `SELECT r2_key FROM media_objects`
3. **Classify** each object with the pure, unit-tested `isOrphan(object,
   referencedKeys, now, graceMs)`: an object is an orphan **only if** its key
   is not in the referenced set **and** its `LastModified` is older than
   `now − graceMs`. Objects with no `LastModified` are never deleted (we don't
   delete what we can't date).
4. **Dry-run** (default) reports counts and deletes nothing. **Apply mode**
   (`JANITOR_APPLY=1`) issues `DeleteObject` per orphan; a single delete
   failure is logged and the sweep continues (never aborts the whole run).

The **grace window** (default 7 days) is the safety mechanism: it protects
in-flight uploads whose DB row hasn't committed yet at the moment the janitor
lists the bucket. Voice tracks in `status: 'pending'` already own a
`storage_key` row, so they read as *referenced* and are safe with no special
case.

---

## 3. Environment

Same credential set as the PG backup (`docs/PG-BACKUP-SETUP.md`) and R2 setup
(`docs/R2-SETUP.md`).

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Railway PG **public** URL |
| `STORAGE_ENDPOINT_URL` | yes | — | `https://<account-id>.r2.cloudflarestorage.com` |
| `STORAGE_BUCKET` | yes | — | `sonic-bloom-media` |
| `STORAGE_ACCESS_KEY_ID` | yes | — | R2 API token |
| `STORAGE_SECRET_ACCESS_KEY` | yes | — | R2 API token |
| `STORAGE_REGION` | no | `auto` | R2 ignores region |
| `JANITOR_GRACE_HOURS` | no | `168` | 7 days; how stale before an unreferenced object is deletable |
| `JANITOR_APPLY` | no | unset | **Must be `1` to actually delete.** Anything else = dry run |

---

## 4. Running it

Always dry-run first and read the orphan count:

```bash
# DRY RUN — lists + classifies, deletes nothing.
DATABASE_URL='postgresql://…' \
STORAGE_ENDPOINT_URL='https://<account-id>.r2.cloudflarestorage.com' \
STORAGE_BUCKET='sonic-bloom-media' \
STORAGE_ACCESS_KEY_ID='…' \
STORAGE_SECRET_ACCESS_KEY='…' \
npm run janitor:r2
```

Expected output: `listed N, referenced M, orphan K, deleted 0, skipped-in-grace G`.

If the orphan count looks right (and you understand *why* each is an orphan),
re-run with apply:

```bash
JANITOR_APPLY=1 DATABASE_URL='…' STORAGE_ENDPOINT_URL='…' STORAGE_BUCKET='…' \
STORAGE_ACCESS_KEY_ID='…' STORAGE_SECRET_ACCESS_KEY='…' \
npm run janitor:r2
```

---

## 5. Scheduling

Same three options as the PG backup — pick one:

### Option A — GitHub Actions (recommended)

Add a workflow mirroring `.github/workflows/pg-backup.yml`. Run **weekly**
(orphans accumulate slowly; daily is overkill). Reuse the same repository
secrets plus a repository **variable** `JANITOR_APPLY=1` once you've validated
a dry run. Suggested cron: `37 4 * * 0` (Sunday 04:37 UTC).

> Keep `JANITOR_APPLY` unset for the first scheduled run so the Action logs a
> dry-run report you can inspect before granting it delete power.

### Option B — Railway cron service

A second Railway service: build `npm install`, start
`JANITOR_APPLY=1 npm run janitor:r2`, cron `37 4 * * 0`, env via
`DATABASE_URL=${{Postgres.DATABASE_URL}}` + the `STORAGE_*` vars.

### Option C — External scheduler

Any cron host with the env set.

---

## 6. Safety + rollback

| Property | Guarantee |
|---|---|
| Default mode | **Dry run** — zero deletes without `JANITOR_APPLY=1` |
| Grace window | Unreferenced objects younger than `JANITOR_GRACE_HOURS` are never touched |
| Undatable objects | Objects with no `LastModified` are never deleted |
| Per-delete isolation | One failed `DeleteObject` is logged; the sweep continues |
| Predicate | `isOrphan` is pure + unit-tested (`scripts/janitor-r2-orphans.test.mjs`) |

**Deletes are irreversible (R0).** Always read the dry-run count before
flipping apply. R2 has no built-in object recovery — once deleted, an object is
gone unless you have it in a separate backup.

**Keep the reference queries in lockstep with the schema.** If you ever add a
new column or code path that stores an R2 key (a new key producer), you MUST
add its `SELECT` to the janitor's reference set first — otherwise the next
sweep will treat those new objects as orphans and delete live data. The
reference queries live in `scripts/janitor-r2-orphans.mjs` (exported as
`REFERENCE_QUERIES`); cross-check against `src/db/schema.ts` whenever storage
keys change.
