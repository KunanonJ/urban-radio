# Cloudflare Access (gate before the app)

This project uses **Cloudflare Pages** for the SPA and **Pages Functions** for `/api/*`. **Cloudflare Access** runs at the **edge**: it shows the Access login *before* your HTML or APIs are served. No React sign-in UI is required for that gate.

## 1. Create an Access application (UAT)

1. Open [Cloudflare One](https://one.dash.cloudflare.com/) → **Access controls** → **Applications**.
2. **Add an application** → **Self-hosted**.
3. **Application domain**: choose how testers reach UAT, for example:
   - **Subdomain**: `uat.yourdomain.com` or your Pages hostname `*.pages.dev`.
   - **Path** (optional): e.g. protect only `/app` — often easier to use a **dedicated hostname** for the app (e.g. `app.uat.example.com`) and leave marketing elsewhere.
4. **Identity providers**: add one or more (one-time password, Google, GitHub, etc.).
5. **Policy**: e.g. allow emails in `@yourcompany.com`, or specific tester emails.
6. Save and copy the **Application Audience (AUD) tag** (Basic information tab).

## 2. Point UAT traffic at Pages

- In **Workers & Pages** → your **sonic-bloom** (or UAT) project, attach the **same hostname** you used in the Access application (custom domain or `*.pages.dev` if supported by your plan and DNS).
- Publish a deployment so the hostname serves `dist/` + Functions.

## 3. Optional: enforce JWT on `/api/*` (this repo)

When **both** of these are set on the **Pages** project (**Settings → Environment variables** for Production / Preview):

| Variable | Example | Purpose |
|----------|---------|--------|
| `ACCESS_TEAM_DOMAIN` | `https://yourteam.cloudflareaccess.com` | Team URL (no trailing slash). |
| `ACCESS_POLICY_AUD` | `<AUD tag from step 1>` | Must match the Access app that protects this hostname. |

- **Unset both** (default): API routes do **not** check JWT — normal for local `wrangler pages dev` and open testing.
- **Set both**: Pages Functions middleware validates the `Cf-Access-Jwt-Assertion` header on `/api/*` ([Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)).

If the site is already behind Access, browsers send the JWT automatically; direct `curl` to `/api/*` without going through Access will fail once enforcement is on.

## 4. Local development

- **`npm run dev`** (Next.js on port 3000) does **not** go through Cloudflare Access.
- **`npm run pages:dev`**: leave `ACCESS_*` unset in `.dev.vars` so APIs stay open, or use a **Cloudflare Tunnel** to a protected hostname if you need Access locally.

## 5. Service tokens (CI / monitors)

For automated clients hitting a **protected** hostname, use [Access service tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/) and send `CF-Access-Client-Id` / `CF-Access-Client-Secret` as required by your policy.

## 6. Landing page behavior

The marketing site at `/` and “Launch app” links are unchanged. Once the **hostname** is protected by Access, users authenticate **before** any route (including `/app`) loads.
