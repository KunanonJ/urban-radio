#!/usr/bin/env node
/**
 * Deploys a static folder to Cloudflare Pages (`wrangler pages deploy`).
 * Prefers `out/` (Next static export) then `dist/` (legacy Vite).
 * Next default `output: "standalone"` / `.next` is not a Pages static bundle — configure export or OpenNext first.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let dir = "out";
if (!existsSync(join(root, "out"))) {
  dir = existsSync(join(root, "dist")) ? "dist" : null;
}

if (!dir) {
  console.error(
    "pages-deploy: No `out/` or `dist/` folder. Run a static Next export to `out/` or restore a Vite `dist/` build before deploying.",
  );
  process.exit(1);
}

const args = ["wrangler", "pages", "deploy", dir];
const slug = process.env.CF_PAGES_PROJECT_NAME?.trim();
if (slug) {
  args.push("--project-name", slug);
}

const r = spawnSync("npx", args, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(r.status === null ? 1 : r.status);
