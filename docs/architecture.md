# Architecture

The map of the codebase, for anyone — human or agent — picking it up cold.

`CLAUDE.md` is the short list of rules you must not break. This document is the
longer explanation of what exists and how the pieces fit, so that those rules
read as consequences rather than arbitrary constraints. The other two developer
documents are [the CSV contract](csv-contract.md) and
[the development workflow](development.md).

## What the app is, in one paragraph

An offline PWA training log, installed to an iPhone home screen. No backend, no
account, no network at runtime — everything lives in IndexedDB on the device. It
is **one half of a coach-in-the-loop workflow**: the coach writes a routine as
Markdown or CSV, the app imports it, sessions are logged against it, and a flat
CSV export goes back to the coach. Almost every design decision below follows
from that loop having a human at each end and no server in the middle.

## Layers

```
screens/ components/     UI. React, hash routing, no derived logic of its own.
        │
        ├──────────► sync/     Composes the three below: fetch → parse → write.
        ├──────────► core/     Pure functions. No React, no Dexie, no DOM.
        │                      metrics · format · import · export · library
        ├──────────► db/       Dexie schema and every mutation.
        │
        └──────────► platform/ The only place that touches browser APIs.
```

The dependency direction is one-way and worth keeping that way:

| Layer | May import | Must not import |
|---|---|---|
| `core/` | other `core/`, types from `db/schema` | React, `db/queries`, anything in `platform/` |
| `db/` | `core/ids`, `core/import/types` | React, screens |
| `platform/` | nothing in the app | everything |
| `sync/` | `core/`, `db/`, `platform/` | React, screens |
| `screens/`, `components/` | all of the above | — |

`sync/` exists because keeping a subscribed routine in step with the coach's
sheet is the one job that needs all three lower layers at once — it fetches,
parses, compares and writes. Putting it in `core/` would have dragged a network
dependency into the layer whose entire value is being testable without one.

Two deliberate exceptions exist and are the only ones:

- `core/` imports **types** from `db/schema`. `SetEntry` is the natural shape for
  a set and duplicating it would guarantee drift. Types only — never `db`.
- `core/import/apply.ts` and `core/export/toJson.ts` do write to the database.
  They are the commit halves of the import and restore flows, and they sit next
  to their parsers because that is where they are read. Everything else under
  `core/` is genuinely pure, which is why the test suite needs no mocks.

Screens may **read** through `useLiveQuery` against `db` directly, but should
**mutate** through `db/queries.ts`. That module is where the invariants live —
`setSetStatus` keeping two fields in step, `deleteSet` renumbering the block,
`mergeExercises` moving history in a transaction. A screen writing to `db`
directly bypasses all of it.

## Module reference

### `core/`

| File | Job |
|---|---|
| `format.ts` | Units, display formatting, and the set-type vocabulary. `setCategory`, `countsAsWorkingSet`, `movedLoad` live here and are the most load-bearing functions in the codebase. |
| `metrics.ts` | Every derived number: volume, estimated 1RM, personal records, logged gaps, hard sets per muscle. |
| `ids.ts` | `newId()`, `localDate()`, `nowIso()`. Dates are local, never UTC — a 22:30 session must not land on tomorrow. |
| `chartTheme.ts` | Chart colours, kept apart from the UI accent because a chart plots magnitude, not identity. |
| `import/types.ts` | The `ParsedRoutine` shape both parsers produce, plus `extractSets` and `cleanExerciseName` — the set-scheme grammar. |
| `import/parseRoutineText.ts` | Markdown and plain text. |
| `import/parseRoutineCsv.ts` | Spreadsheets: delimiter sniffing, BOM, English and Norwegian headers. |
| `import/apply.ts` | Matches parsed names against the library (`resolveNames`) and writes the routine (`commitRoutine`). |
| `export/toCsv.ts` | The coach-facing flat export. See [csv-contract.md](csv-contract.md). |
| `export/toJson.ts` | The backup: `buildBundle`, `parseBundle`, `restoreBundle`. |
| `export/filename.ts` | Deterministic, never-reused filenames. |
| `library/duplicates.ts` | Finds library entries that are the same movement under different names. |
| `library/canonicalNames.ts` | The spellings the programme uses, so a merge lands on the name the *next* import will also use. |
| `import/hash.ts` | Content hash of source text — the cheap "has the sheet changed" gate. |
| `import/classify.ts` | Which names of an incoming update may be applied without a human reading them. |
| `import/diffRoutines.ts` | What actually changed between two revisions, in words. |

### `db/`

`schema.ts` holds the Dexie subclass, the version chain, and every interface.
`queries.ts` holds every mutation and the non-trivial reads.

### `platform/`

`share.ts` — `deliverFile` prefers the iOS share sheet and falls back to an
`<a download>`; `pickTextFile` opens the system picker and works around iOS
firing no event when the picker is cancelled.

`fetchSource.ts` — the only network call in the app. https-only, short timeout,
no retries, and it recognises an HTML body so a link to an unpublished sheet
produces a sentence rather than a parser tantrum.

This layer exists so a Capacitor wrapper could replace it without touching
anything else.

### `sync/`

`updateRoutine.ts` only. `checkRoutineSource` fetches a subscribed routine and
applies it if it clears three gates; `applyPendingSource` releases something that
was withheld. See **Live routine updates** below.

## The data model

Seven tables. Ids are UUIDs from `newId()` throughout; `settings` is a
singleton keyed `'settings'`.

```
Routine ──< RoutineDay ──< RoutineItem >── Exercise
   │             │                            │
   │ (snapshot)  │ (snapshot)                 │
   ▼             ▼                            ▼
Session ─────────────────< SetEntry >─────────┘
                          (+ snapshot of everything above)
```

Solid lines are foreign keys. The dashed intent — the important part — is that a
`SetEntry` does not *need* any of them to be readable.

### Denormalise onto the set, do not join

`SetEntry` carries `exerciseName`, `date`, `perSide` and the whole `planned*`
prescription as copies. This is not an optimisation. Routines get superseded,
exercises get renamed and merged, and a logged session must keep meaning what it
meant when it was logged. Two concrete failures this prevents:

- Flipping an exercise to unilateral would otherwise halve or double the tonnage
  of every session already logged against it.
- Re-importing a routine mid-block would otherwise rewrite what past sessions
  appear to have been asked to do.

The rule to apply when adding a field: **if editing it later would change the
meaning of already-logged history, it belongs on the set.**

### Versioning and superseding

Re-importing a routine of the same name creates a new `Routine` row with
`version + 1` and stamps `supersededBy` on the old one. The old routine stays —
sessions point at it — but drops out of any list the user picks from, so the
`Today` screen cannot start yesterday's revision. `Session.routineVersion`
records which revision was actually performed.

### Status is three-valued

`planned | completed | skipped`, with `isComplete` as an indexed `0 | 1` mirror
of `completed` because IndexedDB cannot index a string union usefully and the hot
queries filter on it. Both fields are written together by `setSetStatus`, which
is the only correct write path.

`finishSession` **keeps** untouched sets. Deleting them was the original bug this
project was asked to fix: it destroyed the only evidence distinguishing a set
that was decided against from one that was never reached. `planned` exports as
`not_logged`; `skipped` is a recorded decision. A skip is never inferred.

### Flags

Anything appearing in a `where` clause is `Flag = 0 | 1`, not a boolean —
`isArchived`, `isComplete`. Fields that never hit an index (`perSide`,
`isUnilateral`) stay optional booleans.

### Weights

Always stored in kg. The unit setting is display-only: `kgToDisplay` /
`displayToKg` convert at the UI boundary and nowhere else. Assistance is stored
as a **negative** weight (an assisted pull-up at `-20`), typed and displayed as a
positive number by `SetRow`, and clamped to zero by `volumeLoad`.

## Set taxonomy

Three categories, not two. This is the single easiest thing in the codebase to
get wrong, and `core/metrics.test.ts` guards it.

| Category | Types | A discrete set | Moved load |
|---|---|---|---|
| `preparatory` | `warmup` | no | no |
| `working` | `working` `top` `backoff` `amrap` `failure` | yes | yes |
| `continuation` | `drop` `myorep` `restpause` | **no** | **yes** |

A drop set, myo-rep or rest-pause extends the set before it and shares its rest
period — that is what makes it an intensity technique rather than extra volume.
Counting it separately inflates every weekly set total and silently broke a hard
training cap. But the load moved, so tonnage includes it.

- `countsAsWorkingSet` — *is a discrete hard set*. Used by personal records,
  estimated 1RM, `working_set_number`, `is_extra`, and per-muscle set counts.
- `movedLoad` — *moved external load*. Used by `volumeLoad` only.

Reach for the predicate that names what you mean, not the one that happens to
give the right answer for the types you were thinking about.

## The three flows

### Import

```
pickTextFile / paste
  → detectFormat()                     ImportScreen
  → parseRoutineCsv | parseRoutineText core/import
  → ParsedRoutine
  → resolveNames()                     core/import/apply
  → NameResolution[]  ← user decides in the preview
  → commitRoutine()                    writes routines/days/items (+exercises)
  → navigate('/routine/:id')
```

`ParsedItem.recognised` records whether a set scheme was actually found on the
line. A line with no scheme **and** no library match is `unreadable`: the preview
defaults it to skipped, and `commitRoutine` skips it again as a backstop even if
no decision arrives. Guessing once put `chest row   x6 @` in the library
permanently and split real chest-row history in two. **Never create an exercise
from a line the importer could not read.**

Names the user links to an existing exercise are recorded as aliases, so the next
import of the same file matches silently. `library/duplicates.ts` is the
backwards application of the same matching, for entries already in the library
with sets attached — fixing the parser does nothing for those.

### Logging

```
Today
  → startSessionFromRoutineDay(dayId)        db/queries
      → startSession()  snapshots routine identity, version, day note
      → seedSessionFromRoutineDay()
          → addSet() × plannedSets, each carrying the prescription
  → SessionScreen  ──< SetRow
      → updateSet() / setSetStatus()
  → finishSession()   keeps untouched rows
  → export offered on the spot
```

`startSessionFromRoutineDay` exists as one function because the two screens that
start sessions had each grown their own copy and drifted — the Today screen
seeded no sets and snapshotted neither the version nor the day note. Anything
that starts a session from a routine goes through it.

The export is offered immediately on finish, while the phone is still in hand,
because anything that has to be remembered after training does not reliably
happen.

### Live routine updates

A routine imported from a link keeps a `RoutineSource` row and is re-read when
the app is opened or foregrounded.

```
App.tsx (after paint, unawaited)
  → checkAllRoutineSources()               sync/updateRoutine
      → fetchSource(url)                   platform — the only network call
      → hashSource(text)      gate 1: did the bytes move at all
      → parseRoutineCsv | parseRoutineText existing, unmodified
      → resolveNames()                     existing, unmodified
      → diffRoutines()        gate 2: did the *routine* move
      → classifyUpdate()      gate 3: is every exercise one we already know
      → commitRoutine(…, { supersedes })   existing, one new option
```

Only something that clears all three gates applies unattended. The gates are
each guarding a different failure:

1. **The hash** stops a poll costing a parse. Without it every launch does real
   work to discover nothing happened.
2. **The diff** stops version churn. A spreadsheet that gains a blank row changes
   the bytes without changing the programme, and cutting a version for that fills
   the history with revisions nobody made.
3. **The classifier** is the safety property. A name only applies unattended when
   it resolves to an exercise that already exists; anything new or unreadable is
   held back and surfaced. This is what keeps auto-update from becoming a back
   door around the import review screen, which exists because guessing once put
   junk in the library permanently.

Two further rules, both consequences of things decided elsewhere:

- **An automatic update never applies while a session is in progress** — the same
  reasoning as `registerType: 'prompt'`. It is stored as pending and applies on a
  later check. Logged sets are snapshot-safe either way; what this protects is
  the un-logged rows of the session in the user's hands. A *deliberate* manual
  apply is allowed, because that is the user acting, not the app acting on them.
- **`commitRoutine` supersedes by id here, not by name.** A subscription passes
  the routine it currently feeds. Matching on name would start a second lineage
  the moment the coach renamed the routine inside their sheet, leaving the
  subscription pointing at a routine nothing updates again.

Failure is never an error state: being offline is this app's normal condition.
A failed check writes `lastError` for a quiet status line and changes nothing.

### Export

```
buildBundle()                    everything, from db
  → narrowToSessions()           optional: one session
  → bundleToCsv(bundle, flavor)  or JSON.stringify
  → deliverFile()                share sheet, else download
```

CSV is prefixed with `UTF8_BOM`, without which Excel on Windows reads the file as
the ANSI codepage and turns `Markløft` into `MarklÃ¸ft`. Restore is
`parseBundle` → `restoreBundle('replace' | 'merge')`.

## Derived values

All of it in `core/metrics.ts`, all pure, all tested by hand-computed values.

| Value | Rule |
|---|---|
| `volumeLoad` | `weight × reps`, doubled when `perSide`, zero for warm-ups, assistance clamped to zero. Reads `perSide` off the **set**, never the exercise. |
| `estimate1rmFromSet` | The RPE chart when the set carries an effort rating, otherwise Epley or Brzycki per settings. RIR is converted to RPE first. Far more accurate on heavy low-rep sets, where reps alone say little. |
| `detectPrs` / `runningPrs` | Weight, reps-at-weight and e1RM records against everything logged before that set, including earlier sets the same day. The first working set of a lift is a baseline, not a record. Warm-ups and continuations never set records. `runningPrs` is the one-pass form and must agree with `detectPrs` run set by set — a test asserts it. |
| `loggedGaps` | Seconds between ticking one set and the one before it. Deliberately **not** called rest: ordered by set position rather than timestamp so out-of-order ticking is detectable, and emitted only where the chain runs forward. A blank beats a number that cannot be trusted. |
| `hardSetsPerMuscle` | Primary muscles count 1, secondary 0.5. Untagged exercises are skipped silently, so the number is honest about what it knows. |

## UI layer

### Routing

A ~50-line hash router in `router.tsx`, deliberately not react-router: GitHub
Pages has no SPA fallback, so path routing would need a `404.html` redirect hack,
and in standalone mode the URL is never visible anyway. `App.tsx` holds the route
table; an unmatched path falls back to `Today`.

| Route | Screen |
|---|---|
| `/` | `Today` — active session, routine days, recent sessions |
| `/session/:id` | `SessionScreen` — the logging screen. `hideNav` |
| `/history`, `/history/:id` | `History`, `SessionDetail` |
| `/progress`, `/progress/:id` | `Progress` — weekly volume, muscle sets, records, per-exercise charts |
| `/library`, `/library/cleanup` | `Library`, `LibraryCleanup` — merges and renames |
| `/exercise/:id` | `ExerciseDetail` |
| `/routine/:id` | `RoutineDetail` |
| `/import` | `ImportScreen` |
| `/settings` | `SettingsScreen` — units, theme, export, restore, wipe |

`Progress` is the only lazy route: it is the sole Recharts consumer and is never
needed mid-session, so splitting it keeps the logging path light.
`SessionScreen` sets `hideNav` so nothing is one stray tap away while lifting.

### Components

`Screen` (header + main + optional back), `Sheet` (bottom sheet, locks body
scroll, closes on Escape and backdrop), `NumberField`, `SetRow`,
`ExercisePicker`, `Nav`, `Icons`, `UpdateToast`.

`NumberField` keeps its own draft string. A plain controlled numeric input
clobbers half-typed values like `137.`, and Norwegian keyboards emit `,` as the
decimal separator. It commits on every valid keystroke, so closing the app
mid-set loses nothing.

`SetRow` is where the set vocabulary meets the screen: it renders only the fields
in `exercise.fields`, shows assistance as a positive number, and puts **Skip
set** behind the row's expander because skipping is a recorded decision.

### Styling

Plain CSS with custom properties, two files: `styles/base.css` (tokens, reset,
shared primitives) and `styles/log.css` (the logging screen and sheets). Class
names are loosely BEM (`setrow__check--on`). There is no CSS framework and no
CSS-in-JS.

Theme resolution has one rule worth knowing: `data-theme` on the root element
always carries the **resolved** theme, never `'system'`. That keeps the CSS
tokens and `chartTheme.ts` reading from one source of truth — otherwise a
system-light phone gets a dark UI with light chart marks. `useResolvedTheme`
resolves it; `App.tsx` applies it and mirrors the preference into
`localStorage` so the inline script in `index.html` can avoid a flash before
paint.

### iOS specifics

`viewport-fit=cover` plus `env(safe-area-inset-*)` tokens; a 44px `--tap`
minimum; **16px minimum font size on every input**, because anything smaller
makes Safari zoom the viewport on focus and the layout never recovers; a 180×180
apple-touch-icon.

## What is deliberately absent

Knowing what was decided against is as useful as knowing what exists.

- **No backend, no accounts, and no sync of training data.** Two devices are
  reconciled by exporting a JSON backup and restoring it in `merge` mode. The
  routine subscription is read-only and one-directional: the app fetches what the
  coach publishes and never sends anything back. The CSV export remains the
  return path.
- **No push.** iOS Safari has no Periodic Background Sync, so "live" means "on
  next open". Anything more would need a server.
- **No rest timer.** Intervals are derived from the timestamps `setSetStatus`
  already writes, so the feature costs nothing and cannot be forgotten.
- **No prescribed weights.** Routines carry structure and free text only. The
  note is shown while lifting and never enforced.
- **No react-router, no state library, no CSS framework, no `@types/node`.**
  `useLiveQuery` over Dexie is the state management.
- **No Apple Health, no Watch app.** Not reachable from a PWA; that is the
  accepted cost of not needing a Mac or a developer account.
- **No autoUpdate service worker.** `registerType: 'prompt'`; a silent reload
  mid-set would be worse than a stale build.
