# AI Workflow Note — Joogle Docs

> Template for the submitter: replace the bullet prompts below with your own
> account. Reviewers evaluate *practical* AI usage, not volume — be specific
> and honest, including where AI output was wrong.

## Tools used

- _e.g. which models / coding assistants, and for which surfaces of the project_

## Where AI materially sped up work

- _e.g. scaffolding, boilerplate, test-case enumeration, copy drafting…_

## AI output I changed or rejected

- _e.g. suggested dependencies you declined, incorrect API usage you rewrote,
  designs you simplified, hallucinated behavior you caught in review…_

## How I verified correctness, UX quality, and reliability

- `npm test` — 17 unit tests covering access rights, lock rules, and file ingestion
- `npm run typecheck` — strict TypeScript, no implicit `any`
- `npm run build` — production build passes
- Manual browser verification of the owner, editor, and read-only viewer states,
  the Identity Context Simulator, refresh persistence, and `.txt`/`.md` import
- _add your own verification steps_
