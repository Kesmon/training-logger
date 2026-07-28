# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server on :5173
npm test             # all tests (vitest, node environment)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build
npm run icons        # regenerate PWA icons from scripts/generate-icons.mjs
```

Single file or single test:

```bash
npx vitest run src/core/metrics.test.ts
npx vitest run -t "does not let a drop set inflate a weekly set cap"
```

Deploy is `git push` to `main`; GitHub Actions builds and publishes to Pages.
`BASE_PATH` in CI comes from the repo name, so the Vite `base` must match the
repository or every asset 404s.

## What this is

An offline PWA training log installed to an iPhone home screen. There is no
backend and no account — all data lives in IndexedDB on the device.

It is **one half of a coach-in-the-loop workflow**: a coach writes a routine as
Markdown or CSV, it is imported, sessions are logged against it, and the CSV
export goes back to the coach. That loop is the reason for most of the design
decisions below.

## Layering

- `src/core/` — pure functions. No React, no database, no browser APIs. This is
  where metrics, importers and exporters live, and why they are testable.
- `src/db/` — Dexie schema and all mutations. Screens may read via `useLiveQuery`
  but should mutate through `queries.ts`.
- `src/platform/` — the only place that touches browser-specific APIs (share
  sheet, file picker). Isolated so a native wrapper could replace it.
- `src/screens/`, `src/components/` — UI.

## Invariants that are easy to break

**The CSV export is a contract with an external consumer.** Column names and
vocabularies were negotiated with the coach; their tooling keys on names.
Adding a column is safe, **removing one is not**. A capturable field has twice
been dropped by accident during a redesign (`set_type`, then nearly `tempo`) —
if the app can record something, the export must carry it.

`SCHEMA_VERSION` in `core/export/toCsv.ts` distinguishes *the app could not
capture this yet* from *the user did not enter it*. Bump it whenever a column
becomes populatable, never otherwise.

**Denormalise onto the set, do not join.** `SetEntry` carries `exerciseName`,
`date`, `perSide` and the whole `planned*` prescription. Routines get superseded
and exercises get merged or renamed; a logged session must stay self-describing
regardless. Anything that would change the meaning of already-logged history if
edited later belongs on the set.

**Set status has three values, not two.** `planned | completed | skipped`, with
`isComplete` as an indexed 0/1 mirror of `completed`. Always write through
`setSetStatus`, never both fields by hand. `finishSession` **must not delete
unticked sets** — deleting them destroyed the only evidence distinguishing a
skipped set from an unlogged one, which was the original bug this project was
asked to fix. A skip is recorded, never inferred.

**Set categories are three-way** (`core/format.ts`):

| Category | Types | Counts as a set | Counts toward volume |
|---|---|---|---|
| preparatory | `warmup` | no | no |
| working | `working` `top` `backoff` `amrap` `failure` | yes | yes |
| continuation | `drop` `myorep` `restpause` | **no** | **yes** |

Continuations extend the set before them, so counting them as separate sets
inflates every weekly set total — which silently broke a hard training cap. But
the load moved, so tonnage includes them. `countsAsWorkingSet` means *is a
discrete hard set*; `movedLoad` means *moved external load*. Personal records,
estimated 1RM, `working_set_number` and `is_extra` all use the former.

`is_extra` and `working_set_number` count among working sets only. Deriving them
from `set_number` flags prescribed work as extra as soon as a warm-up exists.

**Never create an exercise from a line the importer could not read.** A line with
no recognisable scheme *and* no library match is `unreadable`, surfaced in the
preview and skipped by default. Guessing once put junk names in the library
permanently and split real history in two.

**Weights are always stored in kg.** The unit setting is display-only —
`kgToDisplay` / `displayToKg` at the boundary.

**IndexedDB cannot index booleans.** Flags that appear in a `where` clause are
`Flag = 0 | 1`.

## Migrations

`src/db/schema.ts` holds a version chain (currently 3). Adding optional fields
needs no bump; a bump is for backfills and index changes. `migration.test.ts`
builds a real database at the old version, opens it through the current schema,
and asserts the upgrade — worth extending rather than trusting a new migration.

Prescriptions cannot be backfilled: sessions logged before a routine link
existed have no prescription to recover, and blank is the honest answer.

## Documentation that cannot drift

`docs/routine-format.md` is the user-facing guide to writing routines.
`core/import/docExamples.test.ts` extracts its fenced examples and parses them
with the real parser, asserting the documented set counts, reps, durations and
traps. Change parser behaviour and that test tells you which parts of the guide
went stale. Keep it that way.

## PWA specifics

- `registerType: 'prompt'`, never `autoUpdate` — a silent reload mid-session
  would interrupt logging. `UpdateToast` surfaces the waiting worker.
- Routing is a ~50-line hash router (`src/router.tsx`), not react-router:
  GitHub Pages has no SPA fallback, and the URL is invisible in standalone mode.
- No `@types/node`. Tests that need file contents import through Vite
  (`import DOC from '…?raw'`) rather than `node:fs`.
- iOS details in `index.html` and `styles/base.css` — `viewport-fit=cover` plus
  `env(safe-area-inset-*)`, 16px minimum on inputs (anything smaller zooms the
  viewport on focus), 180×180 apple-touch-icon.

## Privacy

The repository is public. It contains app source only. Training data, coach
correspondence and programme details must not be committed — those live outside
the repo.
