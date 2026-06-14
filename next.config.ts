import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Security response headers (H-13 remediation)
// Applied via the headers() lifecycle — covers static, dynamic, and API routes.
// ---------------------------------------------------------------------------

const SECURITY_HEADERS = [
  // Force HTTPS for 1 year, include subdomains, preload-eligible.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  // Deny clickjacking — we don't embed in any other origin.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from MIME-sniffing responses (helps with /api/upload + audio routes).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs cross-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down browser feature access. We use no camera / mic / geo client-side.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

// Stricter CSP for API routes — they should never serve HTML.
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

// CSP for the Next.js app shell.
// 'unsafe-inline' + 'unsafe-eval' are required by Next.js 15's client runtime
// (inline scripts for hydration, eval for dynamic imports in development).
// A nonce-based CSP would be tighter but breaks the page router in this
// version; left as a P2 follow-up per the pentest prioritisation.
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // fonts.googleapis.com serves the @import stylesheet in globals.css; the
  // matching woff2 files come from fonts.gstatic.com. Without these two origins
  // the hardened CSP blocks the app's own fonts in every browser (caught by
  // e2e/console-health). A tighter future option is self-hosting via next/font.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Strip X-Powered-By: Next.js from every response (L-05 / H-13).
  poweredByHeader: false,

  // `standalone` emits `.next/standalone/` with a minimal `node_modules` + a
  // `server.js` entrypoint. The Railway Dockerfile copies just that tree
  // (plus `public/` + `.next/static/`) into the final image, keeping the
  // production image small — no dev/build deps at runtime.
  output: "standalone",

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },

  async headers() {
    return [
      // App shell + everything else.
      {
        source: "/:path*",
        headers: [
          ...SECURITY_HEADERS,
          { key: "Content-Security-Policy", value: APP_CSP },
        ],
      },
      // Override CSP to the strict variant for API routes (no HTML / scripts).
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: API_CSP }],
      },
    ];
  },
};

export default nextConfig;
