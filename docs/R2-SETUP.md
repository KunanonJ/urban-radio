# Cloudflare R2 setup — Sonic Bloom

**What this unlocks:** audio object storage for `POST /api/upload`, voice-track audio on `/api/voice-tracks`, and `GET /api/tracks/[id]/stream`.
**Status today:** `STORAGE_*` env vars unset on Railway → the storage adapter is the unconfigured stub. Upload falls back to a dev-only `{ warning: "R2 or D1 not bound" }` response, and the stream route returns **503 `Media unavailable`**. Setting the four `STORAGE_*` vars flips it live; Railway auto-redeploys.

---

## 1. How the app picks storage (no code change needed)

`src/server/storage.ts` → `getStorage()` decides at runtime:

- It lazily `require('./storage-s3')` and calls `buildS3ConfigFromEnv()`.
- If `STORAGE_ENDPOINT_URL`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, and `STORAGE_SECRET_ACCESS_KEY` are **all present**, it builds an `S3Client` pointed at R2 and returns the `S3Storage` adapter.
- If any are missing, `buildS3ConfigFromEnv()` returns `null` and `getStorage()` falls back to the `UnconfiguredStorage` stub, which throws a clear "Storage not configured" error on every call.
- The adapter is **cached after first build** (HTTP keep-alive / connection pool reuse), so there's no per-request SDK startup cost.

So enabling R2 is purely an env-var operation. There is no flag, no redeploy-with-code-change — just set the four values and let Railway restart the service.

> **R2 is S3-compatible.** It exposes the S3 API at `https://<account-id>.r2.cloudflarestorage.com`, so the app talks to it through `@aws-sdk/client-s3` exactly as it would AWS S3. R2 wants **path-style addressing** (`<endpoint>/<bucket>/<key>`) — see `STORAGE_FORCE_PATH_STYLE` in §4.

---

## 2. The four values you'll set

| Variable | Value | Notes |
|---|---|---|
| `STORAGE_ENDPOINT_URL` | `https://<account-id>.r2.cloudflarestorage.com` | Account-level S3 endpoint. `<account-id>` is your Cloudflare account id (Dashboard → R2 → "Use the S3 API"). |
| `STORAGE_BUCKET` | `sonic-bloom-media` | The bucket name created in §3.2. |
| `STORAGE_ACCESS_KEY_ID` | _(from the API token, §3.3)_ | S3-compatible access key id. |
| `STORAGE_SECRET_ACCESS_KEY` | _(from the API token, §3.3)_ | S3-compatible secret. **Shown once** — copy it immediately. |

Optional, both have safe defaults:
- `STORAGE_REGION` — defaults to `auto` (R2 ignores region).
- `STORAGE_FORCE_PATH_STYLE` — defaults to path-style **on** unless explicitly set to `'0'`. Leave unset for R2.

---

## 3. Step-by-step setup

### 3.1 Enable R2 on your Cloudflare account

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the left sidebar, click **R2**.
3. If this is the first time, click **Purchase R2** / **Enable R2** and accept the plan. R2's storage is pay-as-you-go and has **no egress fees**; at Sonic Bloom's scale this is effectively free (see the cost note in `docs/PG-BACKUP-SETUP.md`).

### 3.2 Create the bucket

1. **R2 → Create bucket**.
2. **Bucket name:** `sonic-bloom-media` (must match `STORAGE_BUCKET` exactly — it's case-sensitive).
3. **Location:** leave **Automatic** unless you have a region requirement.
4. Click **Create bucket**.

Grab your **account id** while you're here: **R2 → Overview → "Use the S3 API"** shows the endpoint `https://<account-id>.r2.cloudflarestorage.com`. That whole string is your `STORAGE_ENDPOINT_URL`.

### 3.3 Generate an S3-compatible API token

1. **R2 → Manage R2 API Tokens** (top-right of the R2 overview page).
2. Click **Create API token**.
3. **Permissions:** **Object Read & Write**.
4. **Scope:** **Apply to specific buckets only → `sonic-bloom-media`**. Do not grant account-wide access — scope it to the one bucket.
5. (Optional) Set a TTL if your org rotates tokens on a schedule; otherwise leave it non-expiring and rotate manually.
6. Click **Create API Token**.

Cloudflare shows the **Access Key ID** and **Secret Access Key** for the S3-compatible API. **The secret is displayed once.** Copy both now:
- Access Key ID → `STORAGE_ACCESS_KEY_ID`
- Secret Access Key → `STORAGE_SECRET_ACCESS_KEY`

> The placeholders below (`<account-id>`, `<access-key-id>`, `<secret-access-key>`) are stand-ins. Never paste real credentials into this doc, a commit, or chat.

### 3.4 Set the vars on Railway

From a terminal where `railway` CLI is logged in to your project:

```bash
railway variables --service sonic-bloom-web \
  --set 'STORAGE_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com' \
  --set 'STORAGE_BUCKET=sonic-bloom-media' \
  --set 'STORAGE_ACCESS_KEY_ID=<access-key-id>' \
  --set 'STORAGE_SECRET_ACCESS_KEY=<secret-access-key>'
```

Or one at a time if you prefer:

```bash
railway variables --service sonic-bloom-web --set 'STORAGE_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com'
railway variables --service sonic-bloom-web --set 'STORAGE_BUCKET=sonic-bloom-media'
railway variables --service sonic-bloom-web --set 'STORAGE_ACCESS_KEY_ID=<access-key-id>'
railway variables --service sonic-bloom-web --set 'STORAGE_SECRET_ACCESS_KEY=<secret-access-key>'
```

Railway auto-redeploys (~30s). On the next process boot, `getStorage()` builds the S3 adapter on first use.

---

## 4. Path-style addressing (`STORAGE_FORCE_PATH_STYLE`)

R2 only fully supports **path-style** addressing (`<endpoint>/<bucket>/<key>`); the AWS default is virtual-host style (`<bucket>.<endpoint>/<key>`) which R2 does not handle cleanly. `buildS3ConfigFromEnv()` defaults `forcePathStyle` to **on** — it's disabled only if you explicitly set `STORAGE_FORCE_PATH_STYLE=0`.

**For R2, leave it unset.** Only set `STORAGE_FORCE_PATH_STYLE=0` if you ever repoint these vars at a real AWS S3 bucket that needs virtual-host style.

---

## 5. Verification flow

After Railway redeploys, do a small round-trip: upload a tiny audio file, then stream it back.

### 5.1 Upload a small audio file → expect 200

`POST /api/upload` requires an authenticated station session and a multipart `file` field. Use a real session cookie/token for your test station.

```bash
# Smallest valid input: any short MP3/WAV. Magic bytes must match a real
# audio format (the route sniffs the first bytes), so use a genuine file.
curl -i -X POST 'https://sonic-bloom-web-production.up.railway.app/api/upload' \
  -H 'Cookie: <your-session-cookie>' \
  -F 'file=@/path/to/tiny-clip.mp3;type=audio/mpeg'
```

Expect:
```
HTTP 200
{"ok":true,"id":"<uuid>","size":<bytes>,"trackId":"cloud-<uuid>"}
```

If you instead see `{"ok":true,...,"warning":"R2 or D1 not bound — dev fallback only"}`, the `STORAGE_*` vars are not all set / not yet picked up — the adapter is still the stub. Re-check §3.4 and that the redeploy finished.

> Note: the upload response intentionally does **not** include the storage `key` (pentest M-08). The client fetches audio through the stream endpoint, which resolves the key server-side.

### 5.2 GET the stream URL → expect 200 audio bytes

Use the `trackId` from the upload response:

```bash
curl -i 'https://sonic-bloom-web-production.up.railway.app/api/tracks/cloud-<uuid>/stream' \
  -H 'Cookie: <your-session-cookie>' \
  --output /tmp/roundtrip.mp3
```

Expect `HTTP 200` with `Content-Type: audio/mpeg` (or whatever you uploaded), `Accept-Ranges: bytes`, and a `Content-Length` matching the original. `ls -l /tmp/roundtrip.mp3` should show the same byte size you uploaded.

A **503 `Media unavailable`** here means the storage adapter is still unconfigured (or the DB client failed to build) — the bytes were never written to R2.

---

## 6. Credentials are shared with backups + the janitor

The **same four `STORAGE_*` values** are reused elsewhere — set them consistently:

- **Postgres backup workflow** (`.github/workflows/pg-backup.yml`, `scripts/backup-pg-to-s3.mjs`) writes daily dumps to `<bucket>/backups/pg/` using `STORAGE_ENDPOINT_URL` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`. Those are **GitHub Actions repository secrets**, separate from Railway — set them in both places. See `docs/PG-BACKUP-SETUP.md`.
- **R2 janitor** — the upload/voice-track paths intentionally leave orphaned objects behind on certain failure branches (e.g. a DB insert fails after the bytes land, or a voice-track delete can't reach storage). The cleanup sweep that reclaims those orphans uses the same bucket + creds. The Object Read & Write token from §3.3 covers both upload/stream and janitor delete operations on `sonic-bloom-media`.

Because the backup and janitor both depend on these, **scope the API token to `sonic-bloom-media` only** (§3.3) so one token blast-radius stays inside the one bucket.

---

## 7. Failure modes + troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `GET .../stream` returns **503 `Media unavailable`** | `STORAGE_*` not all set → adapter is the unconfigured stub (or DB client failed to build) | Set all four vars on Railway (§3.4); confirm the redeploy finished and grep service logs for `[storage] S3 adapter unavailable` |
| Upload returns 200 with `warning: "R2 or D1 not bound — dev fallback only"` | Storage adapter unconfigured, or DB not bound | Same as above — the four `STORAGE_*` vars resolve `buildS3ConfigFromEnv()` from `null` to a real config |
| Upload **415** `Audio MIME type not allowed` | Declared `Content-Type` not in the audio allowlist | Send a real audio MIME (`audio/mpeg`, `audio/wav`, `audio/aac`, `audio/flac`, `audio/ogg`, `audio/mp4`, …). See `ALLOWED_AUDIO_TYPES` in `src/server/upload-helpers.ts` |
| Upload **415** `File content is not a recognized audio format` | Magic-byte sniff failed — the file's first bytes aren't a known audio signature | Upload an actual audio file, not a renamed text/zip. The route validates content, not just the extension |
| Upload **413** `Upload too large` | File exceeds 50 MB (`MAX_UPLOAD_BYTES`) | Trim/transcode below 50 MB, or raise the cap in `upload-helpers.ts` (pentest H-03 set this deliberately) |
| Upload **500** `Storage write failed` | `storage.put` threw a non-"unconfigured" error — wrong creds, bucket missing, endpoint typo | Verify `STORAGE_ENDPOINT_URL` includes the right `<account-id>`; confirm bucket `sonic-bloom-media` exists; re-check the API token has **Object Read & Write** on that bucket |
| `SignatureDoesNotMatch` / `403` in service logs | Wrong `STORAGE_SECRET_ACCESS_KEY`, or virtual-host addressing against R2 | Re-copy the secret (it's shown once — regenerate the token if lost); leave `STORAGE_FORCE_PATH_STYLE` unset so path-style stays on |
| `NoSuchBucket` in logs | `STORAGE_BUCKET` typo or bucket in a different account than the endpoint | Bucket name is case-sensitive and must be `sonic-bloom-media` in the account whose id is in the endpoint |
| Backup job fails to upload but uploads work in-app | GitHub Actions secrets differ from Railway vars | These are two separate secret stores — set the four `STORAGE_*` values in **both** Railway and the repo's Actions secrets |

---

## 8. Production checklist

Before relying on R2 for live audio:

- [ ] R2 enabled on the Cloudflare account
- [ ] Bucket `sonic-bloom-media` created (name matches `STORAGE_BUCKET` exactly)
- [ ] API token created with **Object Read & Write**, scoped to **`sonic-bloom-media` only**
- [ ] All four `STORAGE_*` vars set on Railway (`sonic-bloom-web` service)
- [ ] Same four values set as GitHub Actions secrets for the pg-backup workflow
- [ ] `STORAGE_FORCE_PATH_STYLE` left unset (path-style on, R2-correct)
- [ ] Upload round-trip verified: small file → 200, then stream → 200 with matching bytes
- [ ] Secret stored in your secrets manager / Railway only — never committed or pasted into chat
- [ ] Token rotation plan noted (the same token gates upload, stream, backup, and janitor)
