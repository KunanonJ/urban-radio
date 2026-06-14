import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const alias = { "@": path.resolve(__dirname, "./src") };

/**
 * Two-project layout to bound memory on a mixed suite.
 *
 *  - "node"  — server / db / scripts / functions tests (1210 tests). Pure
 *              logic + pg-mem, no DOM. Fast + green on threads. This is the
 *              CI gate: `npm test` runs ONLY this project, so the critical
 *              path (every API handler, auth, billing, migration) is reliably
 *              exit-0. Run it with `npm test` or `vitest run --project=node`.
 *  - "jsdom" — everything that relied on the old global JSDOM default:
 *              React component + view tests AND the src/lib tests that touch
 *              browser globals (window, navigator, BroadcastChannel, fetch,
 *              localStorage). Run with `npm run test:ui`.
 *
 * KNOWN ISSUE: the jsdom project still OOMs (FATAL heap) when run whole,
 * because the ~73 component test files leak detached DOM / observers / timers
 * across files within a worker. `pool: "forks"` + a 4 GB heap + memory-based
 * recycling delay it but don't cure it — the real fix is per-file cleanup
 * (afterEach unmount / cleanup / fake-timer teardown) across the component
 * suite, tracked separately. Until then the UI suite is best-effort and is
 * NOT in the blocking `npm test` gate. `npm run test:all` runs both projects
 * and may exit 1 on the jsdom OOM by design.
 *
 * Per-file `// @vitest-environment node` directives in src/server still win
 * over the project default, so they remain valid no-ops here.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "node",
          globals: true,
          environment: "node",
          setupFiles: ["./src/test/setup.ts"],
          include: [
            "src/server/**/*.{test,spec}.{ts,tsx}",
            "src/db/**/*.{test,spec}.{ts,tsx}",
            "functions/**/*.{test,spec}.{ts,tsx}",
            "scripts/**/*.{test,spec}.{mjs,ts}",
          ],
          exclude: ["**/node_modules/**"],
          pool: "threads",
          poolOptions: {
            threads: { maxThreads: 2, minThreads: 1 },
          },
          isolate: true,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "jsdom",
          globals: true,
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          include: [
            "src/components/**/*.{test,spec}.{ts,tsx}",
            "src/views/**/*.{test,spec}.{ts,tsx}",
            "src/lib/**/*.{test,spec}.{ts,tsx}",
            "src/hooks/**/*.{test,spec}.{ts,tsx}",
            "src/test/**/*.{test,spec}.{ts,tsx}",
          ],
          exclude: ["**/node_modules/**"],
          // Forks free DOM memory per process + accept the heap-size flag that
          // worker_threads reject. Together: the OOM fix.
          // Single fork, recycled on memory pressure. The component tests
          // leak detached DOM / observers across files; recycling the process
          // once its RSS passes ~1.5 GB reclaims it before it can OOM (raising
          // the heap alone never fixes accumulation). A single fork avoids the
          // ERR_IPC_CHANNEL_CLOSED race that two concurrently-recycling forks
          // hit. Slower than threads, but the node project (the bulk + the
          // CI-critical server tests) still runs fast in parallel.
          pool: "forks",
          poolOptions: {
            forks: {
              maxForks: 1,
              minForks: 1,
              execArgv: ["--max-old-space-size=4096"],
              maxMemoryLimitBeforeRecycle: 1_610_612_736,
            },
          },
          isolate: true,
        },
      },
    ],
  },
});
