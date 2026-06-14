# Product Requirements Document — Sonic Bloom (Next.js + Firebase)

**Document status:** Draft  
**Stack (target):** Frontend — Next.js, shadcn/ui, Tailwind CSS. Backend — Firebase suite (Auth, Firestore, Storage, App Hosting; Cloud Functions as needed).  
**Related:** Domain types `src/lib/types.ts`, migration backlog `docs/MIGRATION-NEXT-FIREBASE.md`, emulator config `firebase.json`.

---

## 1. Executive summary

Sonic Bloom is a **music library and playback-oriented web application**: browse artists, albums, and playlists; search; manage a queue; control playback and volume; and operate from a consistent shell (sidebar, header, player bar, global search). Today the canonical UI ships as a **Vite + React** SPA with **mock / in-memory data**; this PRD defines the **target product** when the experience is delivered on **Next.js** with **Firebase** as the real backend and hosting surface.

**North star:** A signed-in user sees the same information architecture and core workflows as the current app, backed by durable catalog and user data, with media served safely from Firebase Storage and optional server-side glue via Cloud Functions or Next.js Route Handlers where Firebase alone is insufficient.

---

## 2. Goals and non-goals

### 2.1 Goals

- **G1 — Stack alignment:** Ship the app shell and feature routes using **Next.js (App Router)**, **Tailwind CSS**, and **shadcn/ui** (Radix primitives) for accessible, consistent UI.
- **G2 — Identity and tenancy:** Use **Firebase Authentication** (e.g. email/password and Google) so every user has a stable `uid` for private data.
- **G3 — Catalog at scale:** Store **artists, albums, tracks, and optional curated playlists** in **Firestore** with security rules that default to **public read** for catalog and **user-scoped read/write** for private data.
- **G4 — User library state:** Persist **playlists, queue snapshot, and preferences** under `users/{uid}/…` with debounced or heartbeat updates for queue/playback fields to limit writes.
- **G5 — Media pipeline:** Use **Firebase Storage** for audio and artwork paths aligned with `Track` / `Album` fields (`storagePath`, `contentHash`); avoid exposing long-lived public URLs for private libraries without an explicit policy.
- **G6 — Hosting and CI:** Deploy with **Firebase App Hosting** (or Firebase Hosting where appropriate), GitHub-connected previews, and `NEXT_PUBLIC_*` configuration for the web SDK.
- **G7 — Developer experience:** Local development against **Firebase Emulators** (Auth, Firestore, Storage, Emulator UI) without requiring production credentials for routine work.

### 2.2 Non-goals (initial releases)

- **NG1:** Full **OAuth integrations** with third-party music services (Plex, Spotify, etc.) beyond UI/status placeholders unless explicitly scoped; types in `IntegrationSource` remain forward-looking.
- **NG2:** Guaranteed **real-time streaming** or **DRM** for major label catalogs; playback remains browser-based with URLs or signed access patterns the team controls.
- **NG3:** Replacing **Cloudflare Pages / Workers** in one step; cutover is phased per `docs/MIGRATION-NEXT-FIREBASE.md` Epic H.
- **NG4:** **Multi-tenant broadcast automation** as a hard requirement in v1; the repo name suggests radio context, but the current product surface is **library + player** unless product expands scope.

---

## 3. Users and primary jobs-to-be-done

| Persona | Needs |
|--------|--------|
| **Listener / curator** | Browse library, build playlists, queue tracks, adjust playback, search quickly (⌘K-style), use mobile-friendly shell. |
| **Uploader / librarian** | Upload or attach media, see progress, dedupe by content hash, associate metadata with tracks/albums. |
| **Admin / operator** | Seed or maintain catalog, manage security rules and indexes, monitor usage; optional role-gated writes to catalog. |

---

## 4. Product scope — functional requirements

Requirements are grouped by area. **Must** = P0 for first Firebase-backed release; **Should** = P1; **Could** = P2.

### 4.1 Application shell and navigation

| ID | Requirement | Priority |
|----|-------------|----------|
| F-SHELL-1 | **Must:** Layout mirrors existing IA: marketing **/**, authenticated app under **/app** with sidebar, header, player bar, and entry to global search. | P0 |
| F-SHELL-2 | **Must:** Navigation uses **Next.js** primitives (`next/link`, layouts); deep links and dynamic segments behave correctly. | P0 |
| F-SHELL-3 | **Should:** Responsive behavior: desktop sidebar; mobile sheet or equivalent; player and search usable on small viewports. | P1 |
| F-SHELL-4 | **Could:** Internationalization (**en** / **th**) per migration Epic B6 (`next-intl` or i18next). | P2 |

### 4.2 Authentication and authorization

| ID | Requirement | Priority |
|----|-------------|----------|
| F-AUTH-1 | **Must:** Firebase Auth sign-in / sign-out; session persistence across reloads. | P0 |
| F-AUTH-2 | **Must:** Protect **/app** routes (middleware or layout guard) consistent with legacy `VITE_REQUIRE_AUTH` semantics. | P0 |
| F-AUTH-3 | **Should:** Document authorized domains for Firebase Auth + Hosting to avoid misconfigured popups. | P1 |
| F-AUTH-4 | **Could:** Custom claims or admin role for catalog writes (if not using separate admin tools). | P2 |

### 4.3 Catalog (read)

| ID | Requirement | Priority |
|----|-------------|----------|
| F-CAT-1 | **Must:** Load **tracks, albums, artists** (and **playlists** where applicable) from Firestore with shapes compatible with `Track`, `Album`, `Artist`, `Playlist` in `types.ts`. | P0 |
| F-CAT-2 | **Must:** Support listing and detail views aligned with current routes (library, album, artist, playlist). | P0 |
| F-CAT-3 | **Should:** Use **TanStack Query** with Firestore listeners or fetch helpers for caching and loading states. | P1 |
| F-CAT-4 | **Could:** **Search** v1 = client-side filter or simple queries; later = Algolia/Typesense/Extension for full-text. | P2 |

### 4.4 Playback and queue

| ID | Requirement | Priority |
|----|-------------|----------|
| F-PLAY-1 | **Must:** Client-side playback using resolved **media URL** (e.g. signed URL or approved public read policy); `mediaUrl` remains session-oriented in the client model. | P0 |
| F-PLAY-2 | **Must:** Queue operations: add, remove, reorder, next/previous, consistent with current UX expectations. | P0 |
| F-PLAY-3 | **Should:** Persist **queue snapshot** (`trackIds`, `queueIndex`, `volume`) to `users/{uid}/queue/...` with **debouncing** — avoid writing every progress tick. | P1 |
| F-PLAY-4 | **Could:** Cross-device resume (same queue doc, conflict strategy documented). | P2 |

### 4.5 User playlists and settings

| ID | Requirement | Priority |
|----|-------------|----------|
| F-PL-1 | **Must:** CRUD for user-owned playlists under `users/{uid}/playlists`; references to tracks by **id** (subcollection or `trackIds[]` per migration doc). | P0 |
| F-PL-2 | **Should:** Optional **public** playlist flag with rules allowing non-owner read when `isPublic == true`. | P1 |
| F-SET-1 | **Could:** Persist theme, locale, playback flags under `users/{uid}/preferences`. | P2 |

### 4.6 Uploads and storage

| ID | Requirement | Priority |
|----|-------------|----------|
| F-UP-1 | **Must:** Client upload path with progress; store **Storage path** and **content hash** on track documents where applicable (`contentHash`, `storagePath`). | P0 |
| F-UP-2 | **Must:** **Storage security rules** — no open world write; authenticated paths such as `users/{uid}/uploads/**` and/or admin-only `media/**`. | P0 |
| F-UP-3 | **Should:** Optional **Cloud Function** (or Route Handler) to mint **signed URLs** for playback. | P1 |
| F-UP-4 | **Could:** Promotion flow from user uploads to canonical `media/{trackId}/...`. | P2 |

### 4.7 Server / edge behavior

| ID | Requirement | Priority |
|----|-------------|----------|
| F-API-1 | **Should:** Map existing **Cloudflare Pages Functions** (`functions/api/*`) to **Next.js Route Handlers**, **callable/HTTP Functions**, or explicitly drop with rationale (Epic G). | P1 |
| F-API-2 | **Must:** Centralize secrets via Firebase / hosting config; no production keys in repo. | P0 |

### 4.8 Quality and release

| ID | Requirement | Priority |
|----|-------------|----------|
| F-QA-1 | **Must:** **ESLint** clean for Next app; **`next build`** succeeds in CI. | P0 |
| F-QA-2 | **Should:** **Vitest** for libraries; **Playwright** smoke against preview or emulators with auth fixture. | P1 |
| F-QA-3 | **Should:** Definition of done matches migration checklist: routes parity, rules deployed, E2E green, cutover plan executed. | P1 |

---

## 5. Technical architecture

### 5.1 Frontend

| Layer | Choice | Notes |
|-------|--------|--------|
| Framework | **Next.js** (App Router, TypeScript) | Server Components where static; **client components** for player, Zustand, Firestore listeners. |
| Styling | **Tailwind CSS** | Align tokens with existing `index.css` / CSS variables (`glass`, surfaces). |
| Components | **shadcn/ui** | Radix-based primitives in `components/ui/`; extend rather than fork unrelated design systems. |
| State | **Zustand** (ephemeral UI) + **TanStack Query** (server/cache) | Hydrate queue/playlists from Firestore on login. |
| Auth UX | Firebase Auth web SDK | Wrapped in a small provider + `useAuth()` hook. |

### 5.2 Backend (Firebase suite)

| Service | Role |
|---------|------|
| **Firebase Authentication** | User identity; ties Firestore/Storage rules to `request.auth.uid`. |
| **Cloud Firestore** | Catalog collections + `users/{uid}/...` subcollections; `firestore.rules` + `firestore.indexes.json`. |
| **Firebase Storage** | Audio and artwork; `storage.rules`. |
| **Firebase App Hosting** | Build/deploy Next.js; env vars for `NEXT_PUBLIC_FIREBASE_*`. |
| **Cloud Functions** (optional) | Signed URLs, admin maintenance, denormalized counters, webhooks. |
| **Emulators** | `npm run emulators:start` — local Auth, Firestore, Storage, UI. |

### 5.3 Data model (summary)

Authoritative detail: **§2 in `docs/MIGRATION-NEXT-FIREBASE.md`**. At a glance:

- **Catalog:** `artists`, `albums`, `albums/{id}/tracks` (or flat `tracks` alternative).  
- **User:** `users/{uid}`, `users/{uid}/playlists`, `users/{uid}/queue`, optional `preferences`.  
- **Storage:** e.g. `media/{trackId}/...`, `users/{uid}/uploads/...`, optional `artwork/...`.

---

## 6. Non-functional requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NF-1 | Security | Firestore and Storage rules reviewed; least privilege for writes; no sensitive URLs in client bundles beyond public config. |
| NF-2 | Performance | Index all composite queries; paginate large lists; lazy-load artwork/audio. |
| NF-3 | Reliability | Graceful offline/degraded messaging when Firestore unreachable; emulator parity for tests. |
| NF-4 | Accessibility | shadcn/Radix patterns; keyboard search overlay; focus management for dialogs/sheets. |
| NF-5 | Observability | Optional Firebase Performance / Crashlytics / logging for client errors post-MVP. |

---

## 7. Success metrics

- **SM-1:** 100% of **P0** functional requirements in §4 implemented and demoable on a staging Firebase project.  
- **SM-2:** **Playwright** smoke suite passes against **App Hosting preview** or **emulator** baseline.  
- **SM-3:** No **critical** open issues in security rules (public catalog read + scoped user writes validated in Emulator + staging).  
- **SM-4:** **Cutover:** Traffic can be directed per Epic H with rollback path documented.

---

## 8. Phased roadmap (aligned with migration epics)

| Phase | Focus | Epics (from migration doc) |
|-------|--------|------------------------------|
| **P0 — Foundation** | Firebase project, Next scaffold, App Hosting, client Firebase init, emulators | A |
| **P1 — UI parity** | Layout, routes, shell, mock data still OK | B |
| **P2 — Auth** | Providers, guards, E2E auth | C |
| **P3 — Catalog** | Firestore read, indexes, rules v1 | D |
| **P4 — User data** | Playlists, queue sync, preferences | E |
| **P5 — Media** | Storage uploads, signed URL strategy | F |
| **P6 — API cutover** | Replace or retire Cloudflare Functions | G |
| **P7 — Launch** | CI, DNS, decommission old hosting | H |

---

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Firestore query cost / hot documents | Denormalize; paginate; debounce queue writes; monitor usage. |
| Signed URL latency | Cache short TTL; batch requests via Function if needed. |
| Next + Firebase SSR pitfalls | Keep Firebase SDK usage in client boundaries or use Admin SDK only on server with clear separation. |
| Scope creep (integrations) | Keep `IntegrationSource` as UI-only until OAuth is a committed epic. |

---

## 10. Open questions

1. **Tenancy:** Single global catalog vs. per-station or per-org prefix for “radio” deployments?  
2. **Playback policy:** Public read for `media/**` vs. strict signed-URL-only — legal/compliance input.  
3. **Search:** Target vendor and timeline for replacing client-side v1 search.  
4. **Admin:** Will catalog writes be **Console-only**, **custom admin app**, or **Cloud Functions** with service account?

---

## 11. References

- Internal: `AGENTS.md`, `docs/MIGRATION-NEXT-FIREBASE.md`, `docs/TEST-PLAN.md`, `src/lib/types.ts`  
- Firebase: [App Hosting](https://firebase.google.com/docs/app-hosting), [Firestore](https://firebase.google.com/docs/firestore), [Storage security](https://firebase.google.com/docs/storage/security)

---

*End of PRD.*
