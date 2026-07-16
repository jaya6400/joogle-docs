# AI Workflow Note — Joogle Docs

## Tools used

- **Kimi K3 Max** (agentic coding mode, terminal-driven) — used for the full build:
  scaffolding the Next.js 14 App Router project, writing the storage layer
  (`storage.ts`), the `DocumentEditor` component, the hub page, the test suite,
  and driving the install → typecheck → test → build loop end to end from the
  terminal rather than one-shot file generation.
- Used Claude (chat) for planning/reviewing this submission writeup, the commit
  message, and the video script — not for writing application code.

## Where AI materially sped up work

- **Scaffolding**: Next.js App Router structure, Tailwind config, and the
  initial `DocumentItem` / `DocumentPermission` types were generated in minutes
  instead of assembled by hand.
- **Boilerplate**: the localStorage CRUD layer (seeding, guarded mutations),
  the `CustomEvent` change-feed pub/sub, and the cross-tab `storage` event
  listener — mechanical but easy to get subtly wrong; the agent produced a
  working first pass I then reviewed line by line.
- **Test-case enumeration**: the agent proposed the initial list of access-rights
  cases (owner/editor/viewer/no-grant × read/write × share/delete) before I'd
  fully enumerated them myself, which caught a gap I'd missed (non-owners
  attempting `shareDocument`/`revokeAccess`).
- **Self-driven verification loop**: rather than me manually re-running commands
  after each change, the agent ran `npm install` → `npm run typecheck` →
  `npm test` → `npm run build` in sequence and reacted to failures itself
  (see below) — this is where the time savings were largest, since I wasn't
  babysitting the terminal between edits.

## AI output I changed or rejected

- **esbuild postinstall sandboxing**: during `npm install`, esbuild's postinstall
  script got sandboxed in the agent's execution environment. The agent flagged
  this itself rather than silently continuing, and re-verified the dependency
  actually resolved correctly before moving on — I confirmed this by re-running
  the install locally outside the sandbox to be sure nothing was silently broken.
- **Next.js build directory write permissions**: the production build initially
  hit a permissions issue writing to the `.next` output directory. The agent's
  first instinct was to suggest a broader permission change; I had it scope the
  fix to just the build output directory instead, since a blanket permission
  change wasn't necessary and I didn't want that in the final setup.
- **`document.execCommand` usage**: the agent initially reached for a couple of
  additional `execCommand` variants (e.g. font-size controls) that added toolbar
  surface area without adding real value for this assessment's scope. I cut
  these and kept the toolbar to the eight controls actually justified by the
  permission-demo use case (bold/italic/underline/H1/H2/lists/undo/redo).
- **Over-eager sharing UX**: an early pass auto-granted `editor` role by default
  on new shares. I changed this — new grants should require an explicit role
  choice, since silently defaulting to write access is the wrong default for a
  permissions-focused demo.
- **Markdown import scope**: the agent's first import implementation attempted
  to support a wider Markdown subset (tables, nested lists) than the assignment
  needed. I scoped it down to headings, flat lists, bold/italic, and inline
  code — matching what's actually exercised by the seeded demo docs and tests,
  rather than shipping partially-tested Markdown coverage.

## How I verified correctness, UX quality, and reliability

- `npm run typecheck` — strict TypeScript, no implicit `any`, run after every
  meaningful change, not just at the end
- `npm test` — 17 unit tests covering access-rights resolution (owner / editor /
  viewer / no-grant), storage-level lock rules (viewers and strangers cannot
  write; non-owners cannot share or delete), lane isolation per identity,
  persistence round-trips, and file-import conversion/sanitization
- `npm run build` — production build verified clean, including chasing down
  and resolving the `.next` output-directory permission issue above rather
  than working around it
- Manual browser verification, switching identities via the Identity Context
  Simulator:
  - Owner (Alex) — full read/write, share panel grant/re-role/revoke
  - Editor (Sarah on Vendor Comparison Matrix) — full read/write, no share
    admin controls visible
  - Viewer (Alex on Design Critique Notes) — locked canvas, hidden toolbar,
    amber Read-Only Mode banner, confirmed no-op on attempted edits
  - No-grant case — confirmed document does not appear in hub for an
    identity without a permission row
- Refresh persistence — reloaded the browser mid-session and confirmed
  documents, shares, and the active identity all survive
- `.txt` / `.md` import — tested a valid `.md` file (headings/lists/bold
  converted correctly) and an invalid file type (rejected with inline error,
  as stated in the toolbar)
- Cross-tab sync — opened the app in two tabs under different identities and
  confirmed the `storage` event correctly reflects mutations across tabs