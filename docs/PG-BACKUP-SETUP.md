# Postgres backup setup

Daily snapshots of the Railway Postgres database → S3-compatible bucket.

## What runs

`scripts/backup-pg-to-s3.mjs` invoked via `npm run backup:pg`:

1. `pg_dump --format=custom --no-owner --no-acl --clean --if-exists` against `$DATABASE_URL`
2. Uploads the resulting `.dump` blob to `<bucket>/backups/pg/sonic-bloom-pg-<ISO-stamp>.dump`
3. Lists objects under the prefix; deletes anything older than `BACKUP_RETENTION_DAYS` (default 30)

## Where it runs

Two equivalent options — pick one:

### Option A — GitHub Actions (recommended, free)

Already configured at `.github/workflows/pg-backup.yml`. Runs daily at **03:17 UTC**.

Requires repository secrets (Settings → Secrets and variables → Actions):
- `DATABASE_URL` — use the Railway **public** URL (from `railway variables --service Postgres | grep PUBLIC`)
- `STORAGE_ENDPOINT_URL`
- `STORAGE_BUCKET`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`
- Optional: `STORAGE_REGION` (default `auto`), `BACKUP_PREFIX` (default `backups/pg/`), `BACKUP_RETENTION_DAYS` (default `30`)

Trigger manually from the Actions tab → "pg-backup" → "Run workflow" for an ad-hoc backup.

### Option B — Railway cron service

Create a second service in your Railway project with:
- **Source:** This repo (same as web service)
- **Build command:** `npm install`
- **Start command:** `npm run backup:pg`
- **Cron schedule:** `17 3 * * *` (Railway dashboard → Settings → Cron Schedule)
- **Env vars:** Same as the web service plus `DATABASE_URL`. You can use Railway's reference syntax: `DATABASE_URL=${{Postgres.DATABASE_URL}}`

## Restoring from a backup

```bash
# 1. Download the desired backup
aws s3 cp s3://<bucket>/backups/pg/sonic-bloom-pg-<stamp>.dump ./restore.dump \
  --endpoint-url $STORAGE_ENDPOINT_URL

# 2. Restore (DESTRUCTIVE — drops + recreates objects per --clean flag)
pg_restore --clean --if-exists --no-owner --no-acl --dbname=$DATABASE_URL ./restore.dump
```

For Railway PG specifically, use the public URL (rlwy.net proxy) so pg_restore can connect from your local machine.

## Verifying backups

The script logs dump size + upload key after each run. To verify a backup actually round-trips:

```bash
# Download last backup to a tmp file
aws s3 ls s3://<bucket>/backups/pg/ --endpoint-url $STORAGE_ENDPOINT_URL | sort | tail -1
aws s3 cp s3://<bucket>/backups/pg/<latest-key> /tmp/verify.dump --endpoint-url $STORAGE_ENDPOINT_URL

# Try restoring to a scratch DB (DO NOT use production DATABASE_URL here)
createdb sonic_bloom_verify
pg_restore --dbname=postgres://localhost/sonic_bloom_verify /tmp/verify.dump

# Spot-check key tables
psql sonic_bloom_verify -c "SELECT COUNT(*) FROM organizations;"
psql sonic_bloom_verify -c "SELECT COUNT(*) FROM auth_users;"
psql sonic_bloom_verify -c "SELECT COUNT(*) FROM stations;"

# Clean up
dropdb sonic_bloom_verify
```

Run the round-trip verification at least once a quarter (calendar reminder).

## Dry-run before wiring up

```bash
DATABASE_URL='postgresql://...' BACKUP_DRY_RUN=1 npm run backup:pg
```

Runs pg_dump, reports the size + intended key, skips the upload + prune. Useful for confirming the script works before adding cloud secrets.

## Monitoring

- GitHub Actions sends an email to the repo owner when a scheduled job fails (Settings → Notifications)
- Recommended additional: Better Stack / Healthchecks.io — configure the workflow to ping a URL after success so you get alerted on missed runs, not just failures

## Cost estimate

| Component | Cost @ small scale |
|---|---|
| GitHub Actions minutes | Free tier covers ~30k min/mo; daily 5-min run = ~150 min/mo. **Free.** |
| R2 storage | $0.015/GB/mo. 30 days × ~10 MB dumps = ~300 MB. **~$0.005/mo.** |
| R2 egress | Free (R2 has no egress fees). |
| pg_dump load on Railway PG | One sequential read of all tables; insignificant for <1 GB databases |

Total ~$0/mo at current scale.
