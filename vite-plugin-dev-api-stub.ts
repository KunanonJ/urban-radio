import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Serves minimal JSON for `/api/*` during `vite` dev so the SPA does not proxy to
 * wrangler (502) when Pages Functions are not running locally.
 */
export function devApiStubPlugin(): Plugin {
  return {
    name: "dev-api-stub",
    enforce: "pre",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(devApiStubMiddleware);
    },
  };
}

function devApiStubMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
): void {
  const raw = req.url ?? "";
  const pathname = raw.split("?")[0] ?? "";
  if (!pathname.startsWith("/api/")) {
    next();
    return;
  }

  const method = req.method ?? "GET";

  const json = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };

  const notFound = () => json(404, { error: "not found" });

  if (method === "GET" && pathname === "/api/health") {
    json(200, {
      ok: true,
      service: "sonic-bloom",
      time: new Date().toISOString(),
      db: "unavailable",
      trackCount: 0,
      r2: "unbound",
    });
    return;
  }

  if (method === "GET" && pathname === "/api/catalog") {
    json(200, { tracks: [], source: "dev-stub" });
    return;
  }

  if (method === "GET" && pathname === "/api/catalog/albums") {
    json(200, { albums: [] });
    return;
  }

  if (method === "GET" && pathname === "/api/catalog/playlists") {
    json(200, { playlists: [] });
    return;
  }

  if (method === "GET" && pathname === "/api/catalog/artists") {
    json(200, { artists: [] });
    return;
  }

  if (method === "GET" && /^\/api\/catalog\/albums\/[^/]+$/.test(pathname)) {
    notFound();
    return;
  }

  if (method === "GET" && /^\/api\/catalog\/playlists\/[^/]+$/.test(pathname)) {
    notFound();
    return;
  }

  if (method === "GET" && /^\/api\/catalog\/artists\/[^/]+$/.test(pathname)) {
    notFound();
    return;
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    json(200, { authenticated: false, authNotConfigured: true });
    return;
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    json(401, { error: "Invalid username or password" });
    return;
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "POST" && pathname === "/api/upload") {
    json(503, { error: "Upload unavailable in Vite dev stub" });
    return;
  }

  json(404, { error: "not found" });
}
