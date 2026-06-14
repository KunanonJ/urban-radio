# Git + CI/CD setup

The local working directory (`radio-development-main/`) is a ZIP download —
not a git checkout. Before any GitHub Actions workflow (`ci.yml`,
`pg-backup.yml`, `deploy-railway.yml`) will run, the working code needs to
be in a git repo connected to a GitHub remote.

This doc walks through getting from "ZIP download with our changes" to
"GitHub repo with CI green + Railway auto-deploy live", three paths
depending on what you want to preserve.

---

## Path A — Clone fresh + copy our changes over (recommended)

The cleanest option. Preserves the GitHub repo's history; you commit
**only** the changes we made in this session.

```bash
# 1. Clone the actual repo somewhere outside this folder.
cd ~/Developer
git clone https://github.com/KunanonJ/radio-development.git radio-development
cd radio-development

# 2. Confirm what branch you're on.
git status
git log --oneline -5

# 3. Use rsync to copy our changes over (excludes .git so you keep history).
rsync -av --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='.wrangler/' \
  --exclude='playwright-report/' \
  --exclude='test-results/' \
  ~/Developer/radio-development-main/ \
  ./

# 4. Review the diff carefully.
git status --short | head -30
git diff --stat

# 5. Install + verify locally before committing.
npm install
npm run build
npx vitest run src/server/ src/db/

# 6. Stage in logical chunks (don't just `git add .`).
git add docs/
git commit -m "docs: Railway migration plan + pentest reports + setup guides"

git add src/db/ drizzle.config.ts docker-compose.dev.yml
git commit -m "feat: Drizzle schema + Postgres client (Wave RM-α)"

git add src/server/auth/ src/middleware.ts
git commit -m "feat: Next-side auth helpers + middleware (Wave RM-β0)"

git add src/server/ src/app/api/
git commit -m "feat: 47 Next.js Route Handlers mirroring Cloudflare Pages Functions (Wave RM-β)"

git add scripts/migrate-d1-to-pg.mjs scripts/seed-railway-admin.mjs scripts/backup-pg-to-s3.mjs
git commit -m "feat: data sync + admin seed + PG backup scripts"

git add Dockerfile .dockerignore railway.json next.config.ts package.json package-lock.json .env.example .dev.vars.example
git commit -m "build: Railway deploy artifacts (standalone build + Docker)"

git add .github/workflows/
git commit -m "ci: Railway deploy + Postgres backup workflows"

# 7. Push (or open a PR).
git push origin main
```

After push:
- The `ci.yml` workflow runs (lint + tests + E2E + build)
- The `pg-backup.yml` workflow becomes available (waits for the 03:17 UTC cron)
- The `deploy-railway.yml` workflow runs IF you opt into the token path (see below)

---

## Path B — Init git here + force-push

Faster but **destructive** — overwrites whatever's currently on the GitHub
repo's main branch. Only use this if you know nothing on the remote
matters.

```bash
cd ~/Developer/radio-development-main

# Init + connect.
git init
git remote add origin https://github.com/KunanonJ/radio-development.git
git branch -M main

# Stage + commit (single big commit; squash later if desired).
git add .
git status --short | head -20  # sanity check
git commit -m "Sonic Bloom Railway migration complete"

# Push (overwrites remote main — irreversible without rolling back manually).
git push --force-with-lease origin main
```

⚠️ Workrules R1: this is destructive. The `--force-with-lease` flag adds a
safety check ("only force-push if my local copy of `origin/main` is still
the latest") but if there's history on the remote you want to keep, use
Path A instead.

---

## Path C — Manual file-by-file via GitHub web UI

If git tooling is unavailable. Skip — Path A is the right call.

---

## After the push: GitHub Actions setup

### 1. Repository secrets (Settings → Secrets and variables → Actions)

Required for `pg-backup.yml`:
- `DATABASE_URL` — Railway PG **public** URL: `railway variables --service Postgres --json | jq -r .DATABASE_PUBLIC_URL`
- `STORAGE_ENDPOINT_URL` — once R2 is set up (see `docs/STRIPE-WEBHOOK-SETUP.md` for the pattern, replace Stripe → Cloudflare R2)
- `STORAGE_BUCKET`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`

Optional:
- `STORAGE_REGION` (default: `auto`)
- `BACKUP_PREFIX` (default: `backups/pg/`)
- `BACKUP_RETENTION_DAYS` (default: `30`)

Required for `deploy-railway.yml` (token path, optional):
- `RAILWAY_TOKEN` — Account Settings → Tokens → Create → scope: project `sonic-bloom`
- `RAILWAY_PROJECT_ID` — `1f0a7ee5-f83b-488d-85c8-481d74fc25d4`
- `RAILWAY_SERVICE_NAME` — `sonic-bloom-web`

### 2. Repository variables (Settings → Secrets and variables → Actions → Variables)

- `RAILWAY_DEPLOY_VIA_TOKEN` — set to `true` ONLY if you want the GitHub-Actions deploy path. Leave unset to use Railway's built-in GitHub integration (recommended).

---

## Pick a deploy path

| | Pro | Con |
|---|---|---|
| **Railway GitHub integration** (recommended) | Zero secrets to manage. Deploys ~30s faster than Actions (no checkout). Railway shows build logs inline. | Builds happen in Railway's environment — slightly different from CI build env. |
| **`deploy-railway.yml` workflow** | Single source of truth: GitHub Actions controls both CI and CD. Easy to add pre-deploy checks. | Adds 30-60s for Actions checkout + CLI install. Need to manage `RAILWAY_TOKEN`. |

To wire up the **Railway GitHub integration**:
1. Railway dashboard → Project `sonic-bloom` → service `sonic-bloom-web`
2. Settings → Source → "Connect Repo"
3. Authorize Railway to read your GitHub repos
4. Pick `KunanonJ/radio-development` → branch `main`
5. Click Connect. Railway auto-deploys on every push to main.

If you switch to the integration, disable the token workflow:
- Either set `RAILWAY_DEPLOY_VIA_TOKEN` variable to `false` (kept around for future)
- Or rename `.github/workflows/deploy-railway.yml` → `.github/workflows/deploy-railway.yml.disabled`

---

## Cloudflare Pages workflow

The existing `deploy-cloudflare-pages.yml` is **obsolete** now that we've
moved to Railway. Two options:

**Option A — Keep as legacy fallback:** rename to
`.github/workflows/_deploy-cloudflare-pages.yml.disabled` to disable while
keeping the file for reference.

**Option B — Delete:** `git rm .github/workflows/deploy-cloudflare-pages.yml`
along with `wrangler.toml` and the entire `functions/` directory. This is
the right call once you're confident Railway is permanent.

I'd hold off on Option B for at least the first month so you have a
documented escape hatch back to Cloudflare if Railway disappoints.

---

## Verifying CI green after push

After your first push to main:

```bash
gh run list --workflow=ci.yml --limit 1
# or visit: https://github.com/KunanonJ/radio-development/actions
```

Expected outcome on a healthy push:
- `verify` job — lint + unit tests (450+) + migrations tests (29) + Playwright E2E + build — typically 5-10 min
- `deploy-railway` job — skipped unless `RAILWAY_DEPLOY_VIA_TOKEN` is `true`

If `verify` fails:
- `npm run lint` errors → fix locally + push again
- `npm run test` errors → almost certainly a regression introduced after the migration; bisect from `routes-beta*` tests
- `npm run test:e2e` errors → Playwright might need a `data-testid` selector update; commits to follow

Once green, the daily 03:17 UTC `pg-backup` workflow runs unattended.
