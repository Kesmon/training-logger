# Development

How to work on this repository: the test suite, migrations, and step-by-step
recipes for the changes that come up repeatedly.

Read [architecture.md](architecture.md) first for the map. The rules you must not
break are in `CLAUDE.md`; the export contract is in
[csv-contract.md](csv-contract.md).

## Commands

```bash
npm install
npm run dev          # dev server on :5173
npm test             # everything (vitest, node environment)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build
npm run preview      # serve the production build
npm run icons        # regenerate PWA icons from scripts/generate-icons.mjs
```

One file, or one test by name:

```bash
npx vitest run src/core/metrics.test.ts
```

```bash
npx vitest run -t "does not let a drop set inflate a weekly set cap"
```

`npm run build` typechecks first, so a type error fails the build rather than
shipping. TypeScript runs with `strict`, `noUnusedLocals`,
`noUncheckedIndexedAccess` and `verbatimModuleSyntax` — expect to write
`import type` for types and to handle `possibly undefined` on every array index.

## Testing on a device

The app is only really testable on the phone it is built for, and two things
differ from the desktop dev server:

- **The service worker is not active in `npm run dev`.** `vite-plugin-pwa` has no
  `devOptions` enabled, so anything about installation, offline behaviour, or the
  `UpdateToast` prompt has to be checked with `npm run build && npm run preview`,
  or on the deployed Pages URL.
- **`crypto.randomUUID` needs a secure context.** A plain-http LAN dev server is
  not one. `core/ids.ts` already falls back to `getRandomValues` and then to a
  timestamp id, so ids keep working — but if you add anything else that reaches
  for a secure-context API, it will work on the home screen and fail over
  `http://192.168.…`.

## The test suite

`npm test` runs in vitest's **node** environment with `fake-indexeddb/auto`
loaded from `src/test/setup.ts`, so the Dexie tests build real databases. There
are no mocks anywhere, which is a direct consequence of `core/` being pure.

| File | What it guards |
|---|---|
| `core/metrics.test.ts` | Volume, the RPE chart and both rep formulas against hand-computed values, PR rules, `runningPrs` agreeing with `detectPrs`, and the three-way set categories — including the drop-set-inflates-a-set-cap case. |
| `core/import/parseRoutineText.test.ts` | The Markdown grammar and every documented trap: dash-is-not-a-range, distances, blockquotes, `cleanExerciseName`. |
| `core/import/parseRoutineCsv.test.ts` | Delimiter sniffing, BOM, Norwegian headers, headerless files, schemes hidden in the exercise cell. |
| `core/import/apply.test.ts` | That an unreadable line creates nothing — with a decision, without one, and when a corrected name turns out to exist already. |
| `core/import/docExamples.test.ts` | That `docs/routine-format.md` still describes the real parser. |
| `core/export/roundtrip.test.ts` | JSON restore identity, merge mode, and the CSV column behaviour: prescriptions, `is_extra` positioning, never exporting unperformed data, delimiter flavours, quoting. |
| `core/export/filename.test.ts` | Filenames are deterministic and never reused. |
| `core/library/duplicates.test.ts` | Duplicate grouping, which entry survives, canonical-name matching, and `mergeExercises` moving history and repointing routine slots. |
| `db/migration.test.ts` | Each upgrade against a real database built at the old version. |
| `db/startFromRoutine.test.ts` | That starting from a routine lays out rows, snapshots identity and version, and carries the prescription. |
| `core/import/hash.test.ts` | That transport noise (BOM, line endings, trailing blank lines) does not read as a change, but an edit inside a line does. |
| `core/import/classify.test.ts` | That an unknown or unreadable exercise is held back, and that a near-miss suggestion is never auto-linked. |
| `core/import/diffRoutines.test.ts` | Set counts, adds, removes, reorders — and that a set-count change does not also report the note that restates it. |
| `platform/fetchSource.test.ts` | URL validation, the edit-link mistake, HTML bodies, and that every network failure arrives as a `SourceError`. |
| `sync/updateRoutine.test.ts` | The three gates, the session guard, holding back a new lift while applying the rest, and error recovery. |

### Writing tests here

- **`src/**/*.test.ts` only.** `.test.tsx` is not in the include glob, and the
  environment is `node` — there are no component tests. Adding one means
  switching to jsdom (already a devDependency, currently unused) and widening the
  glob. Prefer moving the logic into `core/` and testing it there.
- **No `@types/node`.** Tests that need file contents import through Vite —
  `import DOC from '../../../docs/routine-format.md?raw'` — rather than
  `node:fs`. This also makes the file a real dependency of the test instead of a
  path read at runtime.
- **Database tests** clear the tables in `beforeEach` (see the `wipe()` helper in
  `roundtrip.test.ts`) and drive the app through `db/queries.ts` rather than
  writing rows by hand, so the invariants in those functions are exercised too.
- **Migration tests** pass a unique name to `new TrainingDb(name)`. That
  constructor parameter exists for exactly this reason: build the old schema with
  plain Dexie, write representative rows, close, then open through `TrainingDb`
  to trigger the upgrade.

### The guide that cannot drift

`core/import/docExamples.test.ts` extracts every fenced ` ```markdown ` and
` ```csv ` block from `docs/routine-format.md`, parses them with the real parsers,
and asserts the set counts, reps, durations and traps the prose claims. Change
parser behaviour and it tells you which paragraphs went stale.

This is a feature, not an obstacle. When it fails, the correct response is to
decide whether the parser or the guide is wrong — never to loosen the assertion.
Keep new examples inside fences so they are covered too.

## Migrations

`db/schema.ts` holds the version chain, currently at **3**. Only `version(1)`
declares `.stores()`; the later versions carry that schema forward and add
upgrade functions only.

| Change | Needs a version bump? |
|---|---|
| Adding an optional field to an interface | No |
| Backfilling a value onto existing rows | Yes |
| Adding, removing or changing an index | **Yes, with a new `.stores({…})`** |

The index case is the trap: because only `version(1)` names the stores, adding an
index means writing a fresh `this.version(4).stores({…})` with the **complete**
store definitions, not just the changed table.

When you add a version:

1. Write the `.upgrade()` to be idempotent and total — it runs once, on a device
   holding real training history, with no way to inspect the result.
2. Extend `db/migration.test.ts` rather than trusting it. The existing cases show
   the pattern, including an empty-database case.
3. Assert that the upgrade *did not* disturb neighbouring fields. The v1→v2 test
   checks weights and names survived, not only that `status` appeared.
4. **Do not invent data.** Sessions logged before prescriptions existed have no
   prescription to recover; blank is the honest answer and the test asserts it.

## Recipes

### Add a field the user can capture

The end-to-end checklist, in order. Missing step 5 is how `set_type` and nearly
`tempo` got dropped.

1. **`db/schema.ts`** — add the optional field to `SetEntry` (or `Session`). Ask
   whether editing it later would change the meaning of logged history; if so it
   belongs on the set as a snapshot, not as a join.
2. **`db/queries.ts`** — if it should carry over between sets, add it to the
   `seed` object in `addSet`. Effort is deliberately excluded there: it is the
   thing that actually changes set to set, and a stale value is worse than none.
3. **`core/format.ts`** — add a `LogField` entry and any formatter, if it is a new
   kind of input rather than a variant of an existing one.
4. **`components/SetRow.tsx`** — render it, gated on `exercise.fields.includes(…)`.
5. **`core/export/toCsv.ts`** — add the column, guard it behind `performed` if it
   describes what was done, and bump `SCHEMA_VERSION`. See
   [csv-contract.md](csv-contract.md#adding-a-column).
6. **Tests** — a case in `roundtrip.test.ts` proving the column populates, and one
   in `metrics.test.ts` if any derived number now depends on it.

No migration is needed for an optional field. The JSON backup picks it up for
free, since the bundle is the tables as they are.

### Add a set type

1. Extend `SetType` in `db/schema.ts`.
2. Add it to `SET_TYPES`, `SET_TYPE_LABELS`, `SET_TYPE_SHORT` **and**
   `SET_CATEGORIES` in `core/format.ts`. All four are exhaustive `Record`s, so
   `tsc` will point you at the ones you missed — but `SET_TYPES` is an array and
   will not complain, and a type missing from it simply never appears in the
   picker.
3. Decide the category deliberately, and write the test that pins it. Is it a
   discrete hard set, or a continuation of the one before? Everything downstream
   — set caps, records, e1RM, `working_set_number`, `is_extra` — follows from that
   one choice.

### Change parser behaviour

1. Change the parser and its own test.
2. Run `npx vitest run src/core/import/docExamples.test.ts`. Its failures are a
   list of paragraphs in `docs/routine-format.md` that are now wrong.
3. Update the guide. If the new behaviour deserves an example, add it inside a
   fence so it becomes covered.
4. Check `resolveNames` still refuses to guess. The line between *recognised* and
   *unreadable* is the safety property; a parser that becomes more permissive can
   quietly turn junk into library entries.

### Add a screen

1. Write it in `src/screens/`, using `Screen` for the header and `Sheet` for
   anything modal.
2. Add a route to `ROUTES` in `App.tsx`. Set `hideNav` only for something that
   should not be one tap from anywhere else.
3. Read with `useLiveQuery`, mutate through `db/queries.ts`.
4. If it pulls in a heavy dependency, lazy-load it the way `Progress` does — the
   logging path should not carry code it never runs.

### Touch the routine-subscription path

The rule that must survive any change here: **an update only applies unattended
when every exercise already exists.** `classifyUpdate` is the whole of that
decision, and loosening it — auto-creating from a "clean-looking" line, acting on
a near-miss suggestion — reintroduces the bug the import review screen exists to
prevent, except now it happens without anyone watching.

Two more things that look like bugs and are not:

- `checkRoutineSource` **never throws.** It runs unattended on launch and returns
  a `failed` outcome instead. Do not add a throw to it.
- A deferred update deliberately leaves `lastHash` alone, so the next check still
  sees it as new. Setting it there would mark the update as seen and it would
  never apply.

Testing it needs no network: pass `{ fetch }` in `SyncDeps` and `{ fetcher }` to
`fetchSource`. In the browser, patching `window.fetch` for one origin exercises
the real path end to end — the dev server is http, so a real https link cannot be
used locally.

### Change the library-cleanup heuristics

`core/library/duplicates.ts` is tuned by two thresholds, and they differ on
purpose: `0.6` in `import/apply.ts` where a false positive causes a wrong write,
`0.55` in the cleanup screen where the user reviews every suggestion and a false
positive costs a glance. Move either and `duplicates.test.ts` will tell you
whether genuinely different lifts started matching.

`canonicalNames.ts` is a default, not a rule — the cleanup screen shows the
resulting name in an editable field. Merging onto the spelling the *programme*
uses is what stops the library re-splitting on the next import.

## CI and deploy

`git push` to `main`. `.github/workflows/deploy.yml` runs `npm ci`, `npm test`,
`npm run build`, then publishes `dist` to Pages. **The test suite gates the
deploy**, so a red test does not ship.

Two things in that workflow are load-bearing:

- `BASE_PATH: /${{ repo name }}/` must match the repository, because Vite's
  `base` becomes the asset prefix. Get it wrong and every asset 404s on a page
  that otherwise loads. It is overridable so the same source can deploy to a root
  domain with `BASE_PATH=/`.
- `touch dist/.nojekyll`, without which Pages runs Jekyll and silently drops
  every file whose name starts with `_`.

The `pages` concurrency group has `cancel-in-progress: false` so an in-flight
deploy finishes rather than being interrupted mid-publish.

## Gotchas

Collected from things that have actually gone wrong here.

- **IndexedDB cannot index booleans.** Anything in a `where` clause is
  `Flag = 0 | 1`.
- **Never write `status` and `isComplete` separately.** `setSetStatus` is the only
  correct path, and it is also what stamps `loggedAt` — which is what makes
  intervals derivable without a timer.
- **Dates are local, never UTC.** `localDate()`. A UTC date shifts a late evening
  session onto the next day.
- **Weights are kg everywhere except the input and the label.** If you find
  yourself converting in `core/`, something is in the wrong layer.
- **`exactOptionalPropertyTypes` is off**, so `{ field: undefined }` typechecks
  against an optional field. Dexie's `update` treats an `undefined` value as
  clearing the property, which is what `setSetStatus` relies on when a set is
  un-ticked — deliberate, but easy to trip over elsewhere.
- **16px minimum on inputs.** Anything smaller and Safari zooms the viewport on
  focus, and the layout does not recover.
- **`data-theme` never carries `'system'`.** Resolve it first, or the chart
  colours and the CSS tokens disagree.
- **Prefer `undefined` to a default.** Half the export's meaning is in the
  difference between blank and zero.

## Privacy

The repository is public and contains app source only. Training data, coach
correspondence and programme details live outside it and must not be committed —
including in test fixtures. The test suite's sample routines are deliberately
generic (`GZCLP`, `5/3/1`); keep new ones that way.
