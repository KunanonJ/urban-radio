#!/usr/bin/env node
/**
 * Vite `dist/` + `wrangler pages dev dist` is retired. Next.js serves via `npm run dev` (port 3000).
 * For Cloudflare Pages, use a static export (`out/`) or an OpenNext-style adapter, then point wrangler at that output.
 */
console.error(
  "pages:dev: use `npm run dev` for Next (localhost:3000). Wrangler Pages needs a static output folder; see AGENTS.md.",
);
process.exit(1);
