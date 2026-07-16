# Submission — Joogle Docs

## What is included

| Item | Location | Status |
| --- | --- | --- |
| Source code | This repository | ✅ Complete |
| README with setup/run instructions | `README.md` | ✅ Complete |
| Architecture note | `ARCHITECTURE.md` | ✅ Complete |
| AI workflow note | `AI_WORKFLOW.md` | ⬜ Template — fill in your own process |
| Automated tests | `src/__tests__/document.test.ts` (17 tests) | ✅ Passing (`npm test`) |
| Live deployment URL | _paste deployed URL here_ | ⬜ Deploy via Docker/Vercel and paste link |
| Walkthrough video URL | _paste unlisted Loom/YouTube link here_ | ⬜ Record 3–5 min walkthrough |

## Working end to end

- Create, rename, edit, autosave, delete, and reopen documents (survives refresh)
- Rich-text formatting: bold, italic, underline, H1/H2, bulleted/numbered lists, undo/redo
- `.txt` / `.md` import into the active canvas via `FileReader` (HTML-escaped, Markdown-aware)
- Sharing: grant, re-role (`viewer` ⇄ `editor`), revoke — owner-only administration
- Full permission model: owner & editor → read/write; viewer → locked canvas, hidden
  toolbar, amber Read-Only Mode banner; owned vs. shared lanes in the hub
- Identity Context Simulator with three seeded profiles (Alex Rivera [Primary],
  Sarah Chen, Marcus Vance) — no sign-in needed to verify every sharing state
- Seeded demo data exercising all three clearance paths, plus one-click Reset demo

## Incomplete / out of scope (intentional)

- Real-time collaboration, comments, version history (see `ARCHITECTURE.md` for the
  prioritized next steps and why they were cut)
- Server-side auth — identities are seeded, per the assignment's mock-auth allowance

## Reviewer credentials

None required. Open the app and use the Identity Context Simulator to switch between
`alex@Joogle.internal`, `sarah@Joogle.internal`, and `marcus@Joogle.internal`.
