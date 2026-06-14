// @vitest-environment node
/**
 * Integration tests for H-13 remediation — security response headers.
 *
 * These tests fetch the live Railway deployment and assert that all
 * OWASP-recommended headers are present and correctly valued.
 *
 * Run condition: tests are skipped unless the env var
 * SECURITY_HEADER_LIVE_CHECK=1 is set, so they don't block CI when the
 * Railway service is unreachable (cold start, redeploy in progress, etc.).
 *
 * After every Railway redeploy you can verify manually:
 *   SECURITY_HEADER_LIVE_CHECK=1 npm test -- security-headers
 */

import { describe, expect, test } from "vitest";

const BASE = "https://sonic-bloom-web-production.up.railway.app";

// Allow CI to skip when the live service is unavailable.
const LIVE = Boolean(process.env.SECURITY_HEADER_LIVE_CHECK);

// Fetch helpers that reuse a single HEAD/GET so we aren't making redundant
// network calls per assertion. We use HEAD where possible to skip the body.
async function headRoute(path: string): Promise<Headers> {
  const res = await fetch(`${BASE}${path}`, { method: "HEAD" });
  return res.headers;
}

async function getRoute(path: string): Promise<Headers> {
  const res = await fetch(`${BASE}${path}`);
  return res.headers;
}

describe("security response headers (H-13)", () => {
  // -------------------------------------------------------------------
  // /api/healthz — public API route; no auth required.
  // -------------------------------------------------------------------
  describe("/api/healthz (API route)", () => {
    test.skipIf(!LIVE)(
      "HSTS is present and has max-age >= 31536000",
      async () => {
        const headers = await getRoute("/api/healthz");
        const hsts = headers.get("strict-transport-security");
        expect(hsts).not.toBeNull();
        const match = hsts!.match(/max-age=(\d+)/);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBeGreaterThanOrEqual(31536000);
      }
    );

    test.skipIf(!LIVE)(
      "Content-Security-Policy is the strict API variant (default-src 'none')",
      async () => {
        const headers = await getRoute("/api/healthz");
        const csp = headers.get("content-security-policy");
        expect(csp).not.toBeNull();
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
      }
    );

    test.skipIf(!LIVE)(
      "X-Content-Type-Options is nosniff",
      async () => {
        const headers = await getRoute("/api/healthz");
        expect(headers.get("x-content-type-options")).toBe("nosniff");
      }
    );

    test.skipIf(!LIVE)(
      "X-Frame-Options is DENY",
      async () => {
        const headers = await getRoute("/api/healthz");
        expect(headers.get("x-frame-options")).toBe("DENY");
      }
    );

    test.skipIf(!LIVE)(
      "Referrer-Policy is strict-origin-when-cross-origin",
      async () => {
        const headers = await getRoute("/api/healthz");
        expect(headers.get("referrer-policy")).toBe(
          "strict-origin-when-cross-origin"
        );
      }
    );

    test.skipIf(!LIVE)(
      "Permissions-Policy restricts camera, microphone, geolocation",
      async () => {
        const headers = await getRoute("/api/healthz");
        const pp = headers.get("permissions-policy");
        expect(pp).not.toBeNull();
        expect(pp).toContain("camera=()");
        expect(pp).toContain("microphone=()");
        expect(pp).toContain("geolocation=()");
      }
    );

    test.skipIf(!LIVE)(
      "X-Powered-By is absent",
      async () => {
        const headers = await getRoute("/api/healthz");
        expect(headers.get("x-powered-by")).toBeNull();
      }
    );
  });

  // -------------------------------------------------------------------
  // / — app shell (HTML route); CSP must allow scripts/styles.
  // -------------------------------------------------------------------
  describe("/ (app shell route)", () => {
    test.skipIf(!LIVE)(
      "HSTS is present on the root page",
      async () => {
        const headers = await getRoute("/");
        const hsts = headers.get("strict-transport-security");
        expect(hsts).not.toBeNull();
        expect(hsts).toMatch(/max-age=\d+/);
        expect(hsts).toContain("includeSubDomains");
      }
    );

    test.skipIf(!LIVE)(
      "Content-Security-Policy on app shell allows self + inline scripts",
      async () => {
        const headers = await getRoute("/");
        const csp = headers.get("content-security-policy");
        expect(csp).not.toBeNull();
        expect(csp).toContain("default-src 'self'");
        // Next.js runtime requires unsafe-inline for its hydration scripts.
        expect(csp).toContain("'unsafe-inline'");
        expect(csp).toContain("frame-ancestors 'none'");
      }
    );

    test.skipIf(!LIVE)(
      "X-Frame-Options is DENY on app shell",
      async () => {
        const headers = await getRoute("/");
        expect(headers.get("x-frame-options")).toBe("DENY");
      }
    );

    test.skipIf(!LIVE)(
      "X-Content-Type-Options is nosniff on app shell",
      async () => {
        const headers = await getRoute("/");
        expect(headers.get("x-content-type-options")).toBe("nosniff");
      }
    );

    test.skipIf(!LIVE)(
      "Referrer-Policy is set on app shell",
      async () => {
        const headers = await getRoute("/");
        expect(headers.get("referrer-policy")).toBe(
          "strict-origin-when-cross-origin"
        );
      }
    );

    test.skipIf(!LIVE)(
      "X-Powered-By is absent on app shell",
      async () => {
        const headers = await getRoute("/");
        expect(headers.get("x-powered-by")).toBeNull();
      }
    );
  });
});
