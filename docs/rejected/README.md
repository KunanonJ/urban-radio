# Rejected proposals

Documents in this folder were considered and **not adopted**. They are kept for historical reasoning, not as guidance for current work.

## PRD-NEXT-FIREBASE.md and MIGRATION-NEXT-FIREBASE.md

**Status:** Rejected on 2026-05-13.

**Why:**

1. **Streaming output cannot live on Firebase either.** The headline gap is real Icecast/Shoutcast output — a long-lived TCP connection — which neither Cloudflare Pages Functions nor Firebase Functions can host. The decision to migrate hosting platforms does not solve the actual blocker.
2. **The Cloudflare path is already half-built.** Pages Functions, D1 schema, R2 uploads, HS256 session JWT, and migrations 0001–0003 ship today. A Firebase migration is greenfield work that throws this away.
3. **Edge proximity matters for Thailand-region users.** Cloudflare's anycast network beats Firebase App Hosting `asia-southeast1` for first-byte latency to most ASEAN locations. Pages + Workers also costs less at the traffic levels we're targeting.
4. **Real-time collaboration is solvable on either, but Durable Objects + WebSockets is the simpler bridge.** Firestore real-time listeners are fine for live data but not the right primitive for CRDT-backed multi-cursor presence we want in the clock builder and scheduler.

**Decision:** stay on Cloudflare. Add an external Liquidsoap / AzuraCast sidecar (Fly.io, Railway, or a managed broadcast host) for the streaming engine. See the upgrade plan for details.

If the Cloudflare path proves untenable, revisit. Until then, treat these documents as archived.
