# Joogle Docs

A lightweight, collaborative document editor inspired by Google Docs — built as a
product slice for the Joogle internal-tools pilot.

- **Zero-dependency rich text** — native HTML5 `contentEditable` + `execCommand`
  formatting. No Tiptap / Slate / Lexical / ProseMirror. First-load JS ≈ 97 kB.
- **Mock relational persistence** — a decoupled data layer over `localStorage`
  with users, documents, and a permission join table (`ownerId`, `sharedWith`).
- **Identity Context Simulator** — switch between three pre-seeded profiles in
  the top navbar to verify sharing and permission states instantly. No sign-in.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build
npm start          # http://localhost:3000
```

Docker (optional):

```bash
docker build -t Joogle-docs .
docker run -p 3000:3000 Joogle-docs
```

Tests & typecheck:

```bash
npm test           # 17 unit tests: access rights, lock rules, file ingestion
npm run typecheck  # strict TypeScript, no implicit any
```

## Seeded identities

Use the **Identity Context Simulator** (top-right of the navbar) to switch.

| Name | Email | Role |
| --- | --- | --- |
| Alex Rivera | alex@Joogle.internal | **Primary Account** (default identity) |
| Sarah Chen | sarah@Joogle.internal | Seeded collaborator |
| Marcus Vance | marcus@Joogle.internal | Seeded collaborator |

**Demo seed data** exercises every clearance path out of the box:

- Alex owns **Q3 Launch Plan — Draft** → shared with Sarah (`editor`) and Marcus (`viewer`).
- Sarah owns **Design Critique Notes** → shared with Alex (`viewer`, read-only demo).
- Marcus owns **Vendor Comparison Matrix** → shared with Alex (`editor`).

Use **Reset demo** (hub header) to wipe and reseed at any time.

## Access rules

| Identity opens a document as… | Result |
| --- | --- |
| Owner | Full read/write + share administration (grant, re-role, revoke) |
| Shared `editor` | Full read/write |
| Shared `viewer` | Canvas locked, formatting toolbar hidden, file import disabled, amber **Read-Only Mode** banner |
| No grant | Document is invisible in the hub |

Rules are enforced twice: in the UI (`DocumentEditor.tsx`) and again in the
storage layer (`storage.ts` throws on unauthorized mutations).

## File upload

The editor toolbar includes **Import .txt / .md**. Supported types: `.txt` and
`.md` only (stated in the toolbar and validated on selection — anything else is
rejected with an inline error). Files are read client-side with `FileReader()`
and appended to the active canvas; light Markdown (`#` headings, `-` / `1.`
lists, `**bold**`, `*italic*`, `` `code` ``) is converted to clean editor HTML,
and raw HTML in files is always escaped.

## Project layout

```
src/
  types/index.ts                 # User, DocumentPermission, DocumentItem + access helpers
  utils/storage.ts               # localStorage data layer (seeding, CRUD, share guards)
  components/DocumentEditor.tsx  # contentEditable canvas, toolbar, import, sharing
  app/page.tsx                   # hub: Identity Context Simulator + Personal/Shared lanes
  __tests__/document.test.ts     # access-rights, lock-rule, and ingestion tests
```

See `ARCHITECTURE.md` for priorities, tradeoffs, and the swap path to a real backend.
