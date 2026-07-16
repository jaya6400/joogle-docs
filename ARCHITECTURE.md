# Architecture Note — Joogle Docs

## What I prioritized

Within the timebox I optimized for **one coherent, verifiable slice** of the
Google Docs surface: create → edit → persist → share → experience permissions
from both sides. Everything else was scoped around making that loop feel solid.

1. **Permission clarity over feature breadth.** Three clearance states (owner,
   editor, viewer) with unmistakable UI consequences — including the amber
   Read-Only Mode banner — beat five half-wired features.
2. **A real data layer, mocked at the boundary.** `storage.ts` behaves like a
   relational store (users table, documents table, permission join rows) with
   guarded mutations, so swapping localStorage for Postgres/Supabase later is a
   one-file change with zero UI edits.
3. **Zero-dependency editing.** Native `contentEditable` keeps bundle size at
   ~97 kB first-load JS and rendering effectively instant. The tradeoff —
   `document.execCommand` is deprecated — is acceptable in a timeboxed pilot:
   it is still universally supported, and the command surface is isolated
   behind a single `exec()` helper if a custom selection engine is ever needed.

## Key decisions

- **Stack:** Next.js 14 (App Router) + TypeScript strict + Tailwind + Lucide.
  `layout.tsx` stays a server component; `page.tsx` and below are client
  components because the persistence engine is localStorage. An explicit
  mounted-gate prevents SSR/localStorage mismatches.
- **Schema:** `DocumentItem { id, title, content, ownerId, sharedWith:
  DocumentPermission[], createdAt, updatedAt }` where each permission carries
  `role` (`editor` | `viewer`), `grantedAt`, and `grantedBy`.
- **Defense in depth:** the editor hides/locks UI by clearance, *and* the
  storage layer throws on unauthorized writes (`updateDocument`,
  `shareDocument`, `revokeAccess`, `deleteDocument` are all actor-checked).
  UI bugs therefore cannot become permission bugs.
- **Identity as a first-class reviewer affordance:** the Identity Context
  Simulator is a session row in the store, so identity switches flow through
  the same change feed as data mutations — every surface re-derives from the
  active identity.
- **Change feed:** a tiny `CustomEvent` pub/sub (+ the `storage` event for
  cross-tab sync) keeps hub lanes, the editor, and the share panel consistent
  without a state library.
- **File ingestion:** client-side `FileReader`, `.txt`/`.md` only, light
  Markdown → HTML conversion, and unconditional HTML escaping so imported
  files can never inject markup.

## Testing

`src/__tests__/document.test.ts` (Vitest + jsdom, 17 tests) covers the
behavior a reviewer cares about most: owner/editor/viewer/none clearance
resolution, storage-level lock rules (viewers and strangers cannot write,
non-owners cannot share or delete), lane isolation per identity, persistence
round-trips, and file-import conversion/sanitization. The happy-path UI was
additionally verified end-to-end in a real browser (owner, editor, and
read-only states).

## Intentionally deprioritized

Real-time multi-cursor collaboration, comments/suggestions, version history,
and server-side auth. The localStorage boundary and the seeded-identity model
were chosen specifically so these can be layered on later without reworking
the permission model.

## With another 2–4 hours

1. Document version history (snapshots on save + restore) — the schema already
   carries timestamps; a `versions` table is a natural next join.
2. Export to Markdown/PDF from the canvas.
3. Presence indicators (who is viewing) via BroadcastChannel, as a stepping
   stone toward real-time collaboration.
4. Swap the storage driver for Supabase/Postgres behind the existing
   `storage.ts` interface to demonstrate the full-stack path.
