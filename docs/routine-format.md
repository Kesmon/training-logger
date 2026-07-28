# Writing routines for import

How to write a training programme as a Markdown file the app can read.

Save it as `.md`, put it somewhere the iPhone Files app can see — iCloud Drive
is easiest — then in the app go to **Settings → Import a routine → Choose a
file**. You can also paste the text straight into the box instead.

---

## The short version

```markdown
# Winter Block

## Day A — Squat / Bench
- Barbell Back Squat 5x3
- Bench Press 3x8
- Barbell Row 3x10
- Face Pull 3x15

## Day B — Deadlift / Press
- Deadlift 4x3
- Overhead Press 3x8
- Lat Pulldown 3x12
- Hanging Leg Raise 3x12
```

`#` names the routine, `##` names each day, one exercise per line.

**The only rule that really matters: the first number is the number of sets.**

`Barbell Back Squat 5x3` means **5 sets** of 3 — so the app lays out five blank
set rows for you to fill in. Get this backwards and you will end up with 3 sets,
or worse (see [Traps](#traps) below).

---

## What the app keeps

A routine is a **prescription, not a script**. It lays out the rows and records
what was asked for; you still type what actually happened.

| You write | The app stores |
|---|---|
| `Barbell Back Squat 5x3` | exercise **Barbell Back Squat**, **5** blank rows |
| the `3` | prescribed reps |
| the rest of the line | the note, shown above the sets while you lift |

So `Squat 5x3 @RPE8 — top set then backoff` gives five empty rows with
`5x3 @RPE8 — top set then backoff` shown above them. Nothing is pre-filled and
nothing is enforced — the log records what you *did*.

Both halves reach the export. Every logged set carries `planned_sets`,
`planned_reps_min`, `planned_reps_max` and `planned_note` next to the weight and
reps you actually entered, so a coach can see a missed target, an added set, or
a set that was never reached — rather than having to ask.

If you leave the number off entirely (`Face Pull`), you get **3 sets** by
default. Add or remove rows in the app whenever you like; a row beyond the
prescription is flagged as an extra rather than being mistaken for a normal one.

---

## Structure

### Routine name

The first `#` heading names the routine.

```markdown
# GZCLP
```

If you leave it out, the **file name is used instead** — so `Winter Block.md`
becomes a routine called "Winter Block". Only if you paste text with no heading
and no file does it fall back to "Imported routine".

### Days

Each `##` heading starts a new day.

```markdown
## Day A
## Upper 1
## Monday — Push
```

A line ending in a colon works too, which is handy for quick notes:

```markdown
Push:
- Bench Press 4x6
Pull:
- Barbell Row 4x6
```

Days with no exercises under them are dropped, so a `## Rest` heading costs you
nothing.

### Exercises

Anything that is not a heading becomes an exercise. Bullets are optional but
make the file readable, and all of these work:

```markdown
- Barbell Back Squat 5x3
* Bench Press 3x8
+ Barbell Row 3x10
1. Overhead Press 3x8
2) Lat Pulldown 3x12
- [ ] Face Pull 3x15
```

Bold, italics, `code`, ~~strikethrough~~ and `[links](url)` are stripped from
names, so you can format the file however you like without it leaking into your
exercise library.

---

## Ways to write the sets

All of these are understood. **The first number is always the set count**; what
the second number means depends on the unit after it.

| You write | Sets | Then | Meaning |
|---|---|---|---|
| `Squat 5x3` | 5 | 3 reps | |
| `Squat 5 x 3` · `5×3` · `5*3` | 5 | 3 reps | spacing and symbol are free |
| `Squat 5x3+` | 5 | 3 reps | the `+` rides along in the note |
| `Squat 3x8-10` | 3 | 8–10 reps | a **range** |
| `Plank 3x30s` | 3 | 30 seconds | a **hold**, not reps |
| `Plank 3x2min` | 3 | 120 seconds | |
| `Farmer's Walk 2x20m` | 2 | 20 metres | a **distance**, not reps |
| `Split Squat 2x10 per leg` | 2 | 10 reps **per side** | |
| `Lat Pulldown 4 sets of 12` | 4 | 12 reps | |
| `Knebøy 4 sett` | 4 | — | Norwegian |
| `Face Pull` | 3 (default) | — | |

Anything after the numbers is preserved as the note and shown above the sets, so
prescriptions ride along untouched:

```markdown
- Barbell Back Squat 5x3 @RPE8, last set AMRAP
- Bench Press 3x10 RIR2, 3-1-1-0 tempo
- Deadlift 1x5 @85%, then 3x5 @75%
```

### Rep ranges

`3x8-10` records a minimum of 8 and a maximum of 10. A fixed `3x10` records
10 and 10, so a range and a fixed target are never ambiguous.

**A dash before a note is not a range.** `2x6 — 3 RIR` means six reps with a
note, not a range of six down to three — a dash only opens a range when the
number after it is larger. Both of these do the right thing:

```markdown
- Romanian Deadlift 3x8-10          ← a range, 8 to 10
- Chest-supported row 2x6 — 3 RIR   ← six reps, note "3 RIR"
```

### Timed holds

A trailing `s`, `sec` or `min` makes it a duration rather than reps:

```markdown
- Plank 3x30s
- Dead hang 3x45 sec
- Farmer's Walk 2x1min
```

This also **shapes the exercise**: it is created with a seconds field instead of
weight and reps, so there is somewhere to record what you actually held. The
target and the achieved time stay separate — a 30-second target held for 22
seconds reads as exactly that, which is information rather than a failure.

### One side at a time

`per leg`, `per side`, `each side`, `/side` and `per arm` all mark an exercise
as unilateral:

```markdown
- Bulgarian Split Squat 2x10 per leg
- Pallof press 2x12 each side
- Single-Leg Glute Bridge 3x10/side
```

`2x10 per leg` lays out **two rows, not four**. Each row is one set performed on
both legs: reps is the count *per limb*, volume counts both, and the row counts
as one hard set to each leg. The set row shows `/side` and the exercise carries a
**per side** badge, so which convention you are looking at is never a guess.

You can also toggle this by hand in Library → the exercise → *One side at a time*.

---

## Traps

Four ways to get a surprising result. The import preview now catches most of
them before anything is saved, but it is still worth writing the file so the
question never comes up.

**The app will not create an exercise from a line it couldn't read.** If a line
has no recognisable set count *and* nothing in your library matches it, it is
listed under "Couldn't read these lines" and **skipped by default** — you can
correct the name inline, or let it go. Nothing is written until you tap Import.

### 1. Do not write weight × reps — *warns*

```markdown
- Squat 100x5     ← 100 SETS, not 100 kg
- Squat 40x5      ← 40 sets
```

The first number is always sets. The preview now flags anything above 8 —
*"40 sets — did you mean 40 kg?"* — but it is a warning, not a refusal, because
occasionally you really do want twelve sets. Put the load in the note instead:

```markdown
- Squat 5x5 @100kg     ← 5 sets, note "5x5 @100kg"
```

### 2. Do not put the weight before the scheme — *caught*

```markdown
- Squat 100kg x 5
```

No scheme is recognised here. The trailing `x 5` is stripped as a fragment,
leaving `Squat 100kg`, which matches nothing in your library — so it lands in
"Couldn't read these lines" and is skipped unless you fix it. Write the sets
first and the question disappears:

```markdown
- Squat 5x5 @ 100kg
```

### 3. Free-floating prose — *caught, but quote it instead*

Every non-heading line is read as an exercise. This:

```markdown
## Day A
- Squat 5x5

Deload every fourth week.
```

used to create an exercise called "Deload every fourth week." It now has no set
count and no library match, so it is flagged and skipped.

Better still, **quote it** — see [Notes for a whole day](#notes-for-a-whole-day)
below. A `>` line is a note rather than a skipped mistake, and it shows up in
the gym.

### 4. `###` does not create a sub-day

Headings deeper than your day level get **appended to the day name** rather than
splitting it:

```markdown
## Day A
### Main
- Squat 5x5
### Accessory
- Curl 3x12
```

gives one day called `Day A · Main · Accessory` holding both exercises. That is
usually what you want — a day is a session. If you want them separate, make them
both `##`.

---

## Notes for a whole day

A line starting with `>` is an instruction, not an exercise:

```markdown
# Block 2

> Deload week. Everything at 70%.

## Day A
> If you're still sore, cut the RDLs.
- Barbell Back Squat 5x5
- Romanian Deadlift 3x8
```

A quote **under a day heading** belongs to that day and is shown at the top of
the session while you train. A quote **before any day heading** is guidance for
the whole routine.

Consecutive quoted lines join into one note, so you can wrap however you like.

This is the place for anything that applies to the session rather than to one
exercise — *"stop if the knee complains"*, *"superset the last two"*, *"deload
week"*. Written as plain prose it would be skipped as an unreadable line; quoted,
it ends up where it is useful.

## Re-importing a routine

Importing a routine with a name you have used before creates a **new version**
rather than a duplicate. The old version stays in the database so sessions
already logged against it still resolve, but drops out of the routine list.

Every session records which version it was performed under, so revising a
programme mid-block never rewrites what an earlier session was asked to do. You
do not need to put version numbers in the file name.

## Naming exercises

Names are matched against your library case-insensitively, so `barbell back
squat` finds an existing **Barbell Back Squat**.

When a name is close but not identical, the import preview asks whether it is
the same lift. Say yes and the app **remembers that spelling as an alias**, so
the next import of the same file matches silently and your history stays on one
exercise instead of splitting across three near-duplicates.

Worth doing once: settle on one name per lift and reuse it. `Bench Press`,
`Barbell Bench Press` and `BB Bench` are three different exercises to the app
until you tell it otherwise — and three separate progress charts.

Norwegian names are fine (`Knebøy`, `Markløft`, `Benkpress`); just be consistent.

---

## Worked examples

### Strength block

```markdown
# 5/3/1 Boring But Big

## Day 1 — Squat
- Barbell Back Squat 3x5 — 65/75/85%, last set AMRAP
- Barbell Back Squat 5x10 @50% — BBB
- Hanging Leg Raise 5x15

## Day 2 — Bench
- Bench Press 3x5 — 65/75/85%, last set AMRAP
- Bench Press 5x10 @50% — BBB
- Barbell Row 5x10

## Day 3 — Deadlift
- Deadlift 3x5 — 65/75/85%, last set AMRAP
- Deadlift 5x10 @50% — BBB
- Hanging Leg Raise 5x15

## Day 4 — Press
- Overhead Press 3x5 — 65/75/85%, last set AMRAP
- Overhead Press 5x10 @50% — BBB
- Chin-Up 5x10
```

### Hypertrophy split

```markdown
# Push Pull Legs

## Push
- Bench Press 4x6 RIR2
- Incline DB Press 3x10 RIR1, 3-1-1-0
- Overhead Press 3x10
- Cable Lateral Raise 4x15 — last set myo-reps
- Triceps Pushdown 3x12

## Pull
- Deadlift 3x5 RIR3
- Barbell Row 4x8
- Lat Pulldown 3x12
- Face Pull 3x20
- Barbell Curl 3x10

## Legs
- Barbell Back Squat 4x6 RIR2
- Romanian Deadlift 3x8
- Leg Press 3x12
- Seated Leg Curl 3x12
- Standing Calf Raise 4x15
```

---

## Before you import

- The first number on each line is the **set count**, not a weight
- Add `s` for a hold, `m` for a distance, `per leg` for unilateral work
- Load goes **after** the scheme, where it becomes a note
- No stray sentences — a line the app can't read is skipped, not guessed at
- Exercise names spelled the same way as last time
- Check the preview: it shows every day and exercise, flags which are new, and
  lists anything it couldn't read, before anything is written

Nothing is saved until you tap **Import routine**, so a bad parse costs you
nothing — go back and edit the file.

---

## What ends up in the export

For anyone reading the logged data rather than writing the routine. Each logged
set carries its own prescription:

| Column | From |
|---|---|
| `planned_sets` | the first number |
| `planned_reps_min` / `planned_reps_max` | the second number, or the range |
| `planned_duration_sec` | `30s`, `2min` |
| `planned_note` | the rest of the line |
| `per_side` | `per leg`, `each side` |
| `routine_name` / `routine_version` | which revision was performed |
| `set_status` | `completed` · `skipped` · `not_logged` |
| `is_extra` | a working set beyond `planned_sets` |

`skipped` means you tapped **Skip set** — a decision. `not_logged` means the row
was never touched. They are different facts and the app will not guess between
them, so tap Skip when you mean it.
