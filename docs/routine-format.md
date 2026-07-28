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

## What the app keeps, and what it ignores

A routine carries **structure only** — which exercises, in what order, and how
many sets. It never prescribes weights or reps.

| You write | The app stores |
|---|---|
| `Barbell Back Squat 5x3` | exercise **Barbell Back Squat**, **5** blank sets |
| the rest of the line | a **note**, shown while you lift, never enforced |

So `Squat 5x3 @RPE8 — top set then backoff` gives you five empty rows and the
text `5x3 @RPE8 — top set then backoff` displayed above them as a reminder. You
still type the actual weight and reps as you go, which is the point: the log
records what you *did*, not what you planned.

If you leave the number off entirely (`Face Pull`), you get **3 sets** by
default. Add or remove rows in the app whenever you like.

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

All of these are understood:

| You write | Sets | Note kept |
|---|---|---|
| `Squat 5x3` | 5 | `5x3` |
| `Squat 5 x 3` | 5 | `5 x 3` |
| `Squat 5×3` | 5 | `5×3` |
| `Squat 5*3` | 5 | `5*3` |
| `Squat 5x3+` | 5 | `5x3+` |
| `Squat 3x8-10` | 3 | `3x8-10` |
| `Lat Pulldown 4 sets of 12` | 4 | `4 sets of 12` |
| `Knebøy 4 sett` | 4 | `4 sett` |
| `Plank 3x45s` | 3 | `3x45s` |
| `Farmer's Walk 2x20m` | 2 | `2x20m` |
| `Face Pull` | 3 (default) | — |

Anything after the numbers is preserved as the note, so prescriptions ride along
untouched:

```markdown
- Barbell Back Squat 5x3 @RPE8, last set AMRAP
- Bench Press 3x10 RIR2, 3-1-1-0 tempo
- Deadlift 1x5 @85%, then 3x5 @75%
```

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

### 3. Free-floating prose — *caught*

Every non-heading line is read as an exercise. This:

```markdown
## Day A
- Squat 5x5

Deload every fourth week.
```

used to create an exercise called "Deload every fourth week." It now has no set
count and no library match, so it is flagged and skipped. Still cleaner to put
standing notes where they belong:

```markdown
## Day A (deload every 4th week)
- Squat 5x5 — deload every 4th week
```

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
- Load and rep targets go **after** the scheme, where they become notes
- No stray sentences — every non-heading line becomes an exercise
- Exercise names spelled the same way as last time
- Check the preview: it shows every day and exercise, and flags which exercises
  are new, before anything is written

Nothing is saved until you tap **Import routine**, so a bad parse costs you
nothing — go back and edit the file.
