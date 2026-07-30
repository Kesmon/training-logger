# The CSV export contract

`core/export/toCsv.ts` writes the file that leaves the phone and lands in the
coach's spreadsheet. **Their tooling keys on column names.** Adding a column is
safe. Renaming, reordering or removing one is a breaking change to someone
outside this repository who will not see the commit.

A capturable field has twice been dropped by accident during a redesign —
`set_type`, then nearly `tempo`. The rule that prevents it: **if the app can
record something, the export must carry it.**

The full column reference below is for anyone changing the exporter. The
user-facing summary of the prescription columns lives in
[routine-format.md](routine-format.md), and the round-trip and column behaviour
are asserted in `core/export/roundtrip.test.ts`.

## Shape

- One row per set, plus a header row.
- CRLF line endings, RFC 4180 quoting: a field is quoted if it contains the
  delimiter, a `"`, or a newline, and embedded quotes are doubled.
- Prefixed with `UTF8_BOM` by the callers. Without it Excel on Windows reads
  UTF-8 as the ANSI codepage and `Markløft` arrives as `MarklÃ¸ft`. It is written
  as an escape rather than a literal so it stays visible in diffs and survives
  editors.
- **Every weight is kg.** The unit setting is display-only and does not reach the
  export; that is why the column names say so.
- Sorted by `date`, then `session_id`, then block `order`, then `set_number`.

### Which rows appear

| Session state | Rows exported |
|---|---|
| Finished | **every** row, including `skipped` and `not_logged` |
| In progress | completed sets only |

From a finished session, a set that was planned and not done is exactly the fact
a coach cannot otherwise recover. From a session still in progress, an untouched
row is just work not yet reached, and reporting it would be noise.

### Flavours

`csvFlavor` in settings switches the delimiter and the decimal mark **together**,
which is what makes the file parse:

| Flavour | Delimiter | Decimal |
|---|---|---|
| `international` | `,` | `.` |
| `european` | `;` | `,` |

Excel writes and expects `;` in any locale that uses `,` as the decimal
separator. Getting this wrong turns the whole export into one unusable column.

## `SCHEMA_VERSION`

Currently `3`, emitted in every row. It distinguishes *the app could not capture
this yet* from *the user did not enter it*. Without it, a blank cell in an old
file and a blank cell in a new one are indistinguishable — which was the real
complaint behind a set of always-empty columns.

**Bump it when a column becomes populatable. Never otherwise.** Not for a bug
fix, not for a new screen, not for a reordering that should not be happening
anyway.

## Columns

38 columns, in file order.

### Identity

| Column | Source | Notes |
|---|---|---|
| `schema_version` | constant | See above. |
| `date` | `set.date` | Local calendar date, denormalised onto the set. |
| `routine_id` | `session.routineId` | Blank for a free session. |
| `routine_name` | `session.routineName` | Snapshot — survives deleting the routine. |
| `routine_version` | `session.routineVersion` | Which revision was performed. |
| `session_id` | `set.sessionId` | |
| `day_name` | `session.dayName` | |
| `exercise_id` | `set.exerciseId` | |
| `exercise_name` | `set.exerciseName` | Snapshot, not a join. |
| `exercise_alias_of` | `set.plannedExerciseName` | Only when the routine spelled it differently from the library entry it matched. Blank otherwise. |
| `primary_muscles` | `exercise.primaryMuscles` | `;`-joined. The one column read live off the exercise, because it is a tag rather than a fact about the set. |

### Position

| Column | Source | Notes |
|---|---|---|
| `set_number` | `set.setNumber` | Every row in the block, warm-ups included. |
| `working_set_number` | computed | Position among **working** sets only. |
| `set_type` | `set.setType` | One of the nine types. |
| `set_category` | `setCategory()` | `preparatory` · `working` · `continuation`. |
| `set_status` | `set.status` | `completed` · `skipped` · **`not_logged`** (exported name for `planned`). |
| `is_extra` | computed | `working_set_number > planned_sets`. Blank, not `false`, when nothing was prescribed. |

`working_set_number` and `is_extra` both skip warm-ups and continuations.
Deriving either from `set_number` flags prescribed work as extra the moment a
warm-up or drop set exists — which for this programme is every session.

### What was prescribed

| Column | Source |
|---|---|
| `planned_sets` | `set.plannedSets` |
| `planned_reps_min` | `set.plannedRepsMin` |
| `planned_reps_max` | `set.plannedRepsMax` |
| `planned_duration_sec` | `set.plannedDurationSec` |
| `planned_note` | `set.plannedNote` — the coach's own words |

All five are snapshots taken when the session was laid out, and they carry over
to sets added beyond the prescription — which is exactly what makes such a set
identifiable as extra. Blank on sessions not started from a routine, and blank on
sessions logged before prescriptions existed: those cannot be backfilled, and
blank is the honest answer rather than a guess.

Reps are always both bounds or neither. A fixed `3x10` sets them equal; `3x8-10`
sets 8 and 10. A single column would have to truncate a range or stringify it,
and either way a consumer has to decide what it meant.

### What was done

Populated **only when `set.status === 'completed'`**.

| Column | Source |
|---|---|
| `weight_kg` | `set.weightKg` — negative means assistance |
| `reps` | `set.reps` |
| `per_side` | `true` or blank |
| `duration_sec` | `set.timeSec` |
| `distance_m` | `set.distanceM` |
| `effort_type` | `rpe` or `rir`, only when a value was entered |
| `effort_value` | `set.effortValue` |
| `tempo` | `set.tempo` |
| `volume_kg` | `volumeLoad(set)`, blank when zero |

The performed-only guard matters: new sets are seeded from the previous one, so
an untouched row can hold a weight and rep count that were never lifted.
Exporting those would invent training that did not happen.

`per_side` is blank rather than `false` on bilateral work, so it reads as *not
applicable* instead of *checked, and no*. It is read off the set's own snapshot,
never the exercise.

### Timing and notes

| Column | Source | Notes |
|---|---|---|
| `performed_at` | — | **Always blank. Reserved.** The app has no notion of when a set was performed as distinct from when it was ticked. The column exists so that adding one later does not change the header. |
| `logged_at` | `set.loggedAt` | Stamped by `setSetStatus` on completion. |
| `logged_gap_sec` | `loggedGaps()` | Interval since the previous set was ticked. Blank where the chain does not run forward — see below. |
| `set_note` | `set.notes` | |
| `session_rpe` | `session.sessionRpe` | Same value repeated on every row of the session. |
| `bodyweight_kg` | `session.bodyweightKg` | Likewise. |
| `session_note` | `session.notes` | Likewise. |

`logged_gap_sec` is **not rest** and is deliberately not named as though it were.
It is a write-time interval: if sets are ticked out of order, or several at once
after the fact, it means nothing. So it is emitted only where the timestamps run
forward in set order, and the chain restarts across a skipped or unlogged set
rather than spanning it.

`session.dayNote` — the coach's instruction for the day — is the one capturable
field intentionally **not** exported. It travels from the coach to the phone, so
there is nothing to report back. Its counterpart `session_note` is hers.

## Blank versus zero

The distinction is load-bearing throughout and should be preserved in anything
new:

- **Blank** — not applicable, or not known. `is_extra` on a free session,
  `per_side` on bilateral work, `volume_kg` on a warm-up, every performance
  column on a row that was not performed.
- **`0`** — measured as zero. A rep count of zero on a failed set is a fact.

`num()` returns `''` for `undefined`, `null` and non-finite values, and `bool()`
returns `''` for `undefined`. Prefer `undefined` over a default when the honest
answer is "there is nothing to say here".

## Adding a column

1. Add the name to `COLUMNS` — **at the end**, unless you have a reason strong
   enough to coordinate with the coach's tooling.
2. Push the value onto `row` at the matching index. The two lists are positional
   and nothing checks that they agree, so count carefully.
3. Decide blank-versus-zero deliberately, and guard it behind `performed` if it
   describes what was done rather than what was asked.
4. Bump `SCHEMA_VERSION` if this makes a previously uncapturable field
   populatable.
5. Extend `core/export/roundtrip.test.ts`. The existing cases show the pattern:
   build a small bundle, export, assert on the parsed row.
6. If the field is also user-visible in the routine format, update the table in
   [routine-format.md](routine-format.md) — `docExamples.test.ts` will tell you
   if the guide's examples no longer match the parser.
