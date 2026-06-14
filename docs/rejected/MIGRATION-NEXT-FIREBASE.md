# Next.js + Firebase migration — backlog & Firestore model

Source domain types: `src/lib/types.ts`, seed shape: `src/lib/mock-data.ts`.

---

## Epics & ordered stories

### Epic A — Foundation & hosting
| # | Story / task | Outcome |
|---|----------------|---------|
| A1 | Create Firebase project; enable Auth (email + Google), Firestore, Storage, App Hosting | Console ready |
| A2 | Scaffold Next.js (App Router, TypeScript, Tailwind, path alias `@/`) in new app or monorepo package | `next dev` runs |
| A3 | Connect **Firebase App Hosting** to GitHub; env vars for web SDK (`NEXT_PUBLIC_*`) | Preview deploys on PR |
| A4 | Add Firebase client init (`firebase/app`, `auth`, `firestore`, `storage`) in a client provider | Single import surface |
| A5 | Add **Firebase Emulator** profile + npm scripts (`emulators:start`) | Local dev without prod |

### Epic B — UI parity (no Firebase data yet)
| # | Story / task | Outcome |
|---|----------------|---------|
| B1 | Port root layout, fonts, `index.css` / theme tokens | Visual baseline |
| B2 | Map routes: `/`, `/app`, `/app/*` using `app/` layouts mirroring `AppLayout` | Same IA as Vite app |
| B3 | Port shell: sidebar, header, player bar, search entry (client components where needed) | Shell navigable |
| B4 | Port pages from `src/pages/app/*` to `app/app/...`; keep mock imports temporarily | Feature parity UI |
| B5 | Replace React Router links with `next/link`; `useSearchParams` / dynamic segments as needed | Navigation correct |
| B6 | Configure **i18next** (or `next-intl`) for `en` / `th` | Locales work |

### Epic C — Authentication
| # | Story / task | Outcome |
|---|----------------|---------|
| C1 | Auth provider + `useAuth()`; session persistence | Log in / out |
| C2 | Protect `/app` (middleware or layout guard) matching `VITE_REQUIRE_AUTH` behavior | Gated app |
| C3 | Map `demo` user flow to Firebase test users or remove | E2E auth path clear |
| C4 | Document authorized domains for Hosting | No auth popup surprises |

### Epic D — Firestore catalog (read path)
| # | Story / task | Outcome |
|---|----------------|---------|
| D1 | Create collections per §2; seed script or admin import from mock JSON | Data in Firestore |
| D2 | Implement `getCatalogTracks`, `getAlbums`, `getArtists`, `getPlaylists` (server or client + rules) | Parity with `catalog-queries` |
| D3 | Wire TanStack Query to Firestore listeners or fetch helpers | Cached catalog |
| D4 | Add composite indexes (§3) to `firestore.indexes.json` | No index errors |
| D5 | Security rules v1: public read catalog; deny write (§4) | Safe default |

### Epic E — User data & queue
| # | Story / task | Outcome |
|---|----------------|---------|
| E1 | `users/{uid}/queue` or `playbackState` doc: queue ids, index, volume (not full `Track[]` if large) | Persisted queue |
| E2 | User playlists CRUD under `users/{uid}/playlists` | Matches `Playlist` ownership |
| E3 | Optional: `users/{uid}/settings` for theme, locale, integrations flags | Settings persist |
| E4 | Migrate Zustand: keep ephemeral UI; hydrate queue from Firestore on login | Single source of truth |

### Epic F — Media & uploads
| # | Story / task | Outcome |
|---|----------------|---------|
| F1 | Storage layout §5; upload from client with progress; store `storagePath` + `contentHash` on `tracks` | Replaces `cloudKey` |
| F2 | Security rules: authenticated write to `users/{uid}/uploads/**` or admin-only `media/**` | No open bucket |
| F3 | Optional Cloud Function: generate signed URL for playback; or public read with path obscurity | `mediaUrl` strategy |
| F4 | Migrate any Cloudflare `/api/upload` behavior | No CF dependency |

### Epic G — Server / edge logic
| # | Story / task | Outcome |
|---|----------------|---------|
| G1 | List Cloudflare Pages Functions (`functions/api/*`) and map each to Next Route Handler, Callable Function, or drop | No orphan APIs |
| G2 | Secrets (JWT, Access, etc.) → Firebase config / Functions config | Document env matrix |
| G3 | Remove `wrangler`, `functions/` from active deploy after cutover | Repo simplified |

### Epic H — Quality & cutover
| # | Story / task | Outcome |
|---|----------------|---------|
| H1 | Vitest: move tests next to `lib/`; fix imports | Green unit tests |
| H2 | Playwright: `baseURL` to App Hosting preview or emulator; auth state fixture | Green E2E |
| H3 | GitHub Actions: `next build`, lint, test; optional deploy via Firebase | CI parity |
| H4 | DNS: point domain from Cloudflare Pages to Firebase Hosting / App Hosting | Traffic moved |
| H5 | Decommission Cloudflare project (after TTL / rollback window) | Cost & ops cleanup |

---

## Firestore schema (from `types.ts`)

Use **string document IDs** (existing `id` fields) where stable; otherwise auto-ID + field `slug`.

### 2.1 Global catalog (read-mostly, optional multi-tenant prefix)

| Collection | Document | Fields (map from type) | Notes |
|------------|----------|-------------------------|--------|
| `artists` | `{artistId}` | `name`, `artwork`, `genres[]`, `albumCount`, `trackCount`, `monthlyListeners?`, `updatedAt` | Denormalized counts maintained on write or via Function |
| `albums` | `{albumId}` | `title`, `artistId`, `artistName` (denorm), `artwork`, `year`, `genre`, `trackCount`, `source`, `dateAdded?`, `updatedAt` | Omit embedded `tracks[]` at scale; use subcollection |
| `albums/{albumId}/tracks` | `{trackId}` | `title`, `artistId`, `artist`, `albumId`, `album`, `duration`, `artwork`, `source`, `genre`, `year`, `trackNumber`, `dateAdded?`, `storagePath?`, `contentHash?` | `mediaUrl` stays client-only session URL |
| `playlists_public` | `{playlistId}` | `title`, `description`, `artwork`, `trackCount`, `duration`, `createdBy`, `isPublic: true`, `trackIds[]` or subcollection `items` | Only if you need curated public lists |
| `integrations_catalog` | `{sourceType}` | mirror `IntegrationSource` for static-ish config | Optional; could stay JSON in Hosting |

**Alternative (flatter):** top-level `tracks` with `albumId`, `artistId` + queries; simpler migrations, more index needs.

### 2.2 Per-user data

| Path | Fields | Notes |
|------|--------|--------|
| `users/{uid}` | `displayName`, `email`, `photoURL`, `createdAt` | Profile |
| `users/{uid}/playlists/{playlistId}` | same as `Playlist` but `trackIds: string[]` or subcollection `items/{trackId}` with `position` | `createdBy` = uid |
| `users/{uid}/queue/current` | `trackIds: string[]`, `queueIndex`, `volume`, `updatedAt` | Small doc for playback |
| `users/{uid}/preferences` | theme, locale, playback flags | Optional split docs |

### 2.3 Types not stored as-is

- **`PlaybackState`**: client + thin `queue/current` sync; avoid writing every progress tick (debounce or heartbeat).
- **`SearchResult`**: derived query across collections or Algolia/Typesense later; v1 = client filter or single collection group query.

---

## Composite indexes (examples)

Add to `firestore.indexes.json` as you add queries:

- `tracks`: `albumId` ASC + `trackNumber` ASC  
- `albums`: `artistId` ASC + `year` DESC  
- `users/{uid}/playlists` queries: `isPublic` + `title` (if shared)

---

## Security rules (sketch — validate in console)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artists/{id} { allow read: if true; allow write: if false; }
    match /albums/{albumId} {
      allow read: if true;
      allow write: if false;
      match /tracks/{trackId} {
        allow read: if true;
        allow write: if false;
      }
    }
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      match /playlists/{pid} {
        allow read: if request.auth != null && request.auth.uid == uid
          || resource.data.isPublic == true;
        allow write: if request.auth != null && request.auth.uid == uid;
      }
      match /queue/{doc} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

Tighten `playlists` public read if you expose `isPublic` playlists to anonymous users.

---

## Cloud Storage layout (sketch)

| Path | Use |
|------|-----|
| `media/{trackId}/{filename}` | Canonical uploaded audio (admin or trusted uploader) |
| `users/{uid}/uploads/{uploadId}` | User-generated uploads before promotion to `media/` |
| `artwork/{albumId}.jpg` | Optional centralized artwork |

Playback: signed URL from Function or short-lived token pattern; **do not** expose long-lived public URLs for private libraries without rules.

---

## Definition of done (migration)

- [ ] All user-facing routes from Vite app work on Next + Firebase.
- [ ] Auth and catalog rules deployed; no test keys in repo.
- [ ] Playwright smoke passes against staging.
- [ ] Cloudflare Workers/Pages decommissioned or archived.

---

## References

- [Firebase App Hosting](https://firebase.google.com/docs/app-hosting)
- [Firestore data model](https://firebase.google.com/docs/firestore/data-model)
- [Storage security](https://firebase.google.com/docs/storage/security)
