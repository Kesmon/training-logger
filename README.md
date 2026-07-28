# Training Logger

An offline strength-training log that installs on an iPhone home screen without
the App Store, a Mac, or an Apple developer account.

Weights, reps, RPE or RIR, tempo, set types, session and per-set timestamps.
Imports routines from a spreadsheet or a Markdown list, exports everything back
out as a JSON backup and a flat CSV. All data stays on the phone.

---

## Getting it onto your iPhone

**1. Publish it.** Create a GitHub repo and push this folder to `main`. The
workflow in `.github/workflows/deploy.yml` builds and publishes on every push.

In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
The first deploy takes a minute or two. Your URL will be:

```
https://<your-username>.github.io/<repo-name>/
```

The base path is taken from the repository name automatically, so nothing needs
editing as long as the repo and the URL match. A private repo works fine.

**2. Install it.** Open that URL in **Safari** on the iPhone — it must be Safari,
not Chrome. Tap **Share** → **Add to Home Screen**.

It now has its own icon, launches full-screen with no browser chrome, and works
with no signal. Updates arrive silently on the next launch after a push; if one
lands while the app is open you get a "New version available" prompt rather than
a reload mid-set.

> **Why a PWA and not a real `.ipa`:** compiling a native iOS app needs macOS.
> The sideload route (GitHub Actions macOS runner → AltStore) also expires every
> 7 days on a free Apple ID. This has no expiry and no Mac in the loop. The cost
> is no Apple Health and no Watch app — neither is reachable from a PWA.

---

## Importing routines

Two formats, both auto-detected. Settings → Import a routine, then either choose
a file or paste the text.

**Spreadsheet (CSV)** — only `exercise` is required.

```csv
routine,day,order,exercise,sets,note
GZCLP,Day A,1,Barbell Back Squat,5,5x3+ T1
GZCLP,Day A,2,Bench Press,3,3x10 T2
GZCLP,Day B,1,Deadlift,5,
```

The parser sniffs the column separator, so a Norwegian-locale Excel export using
`;` works unchanged, as do tabs. It strips the BOM Excel prepends, accepts
Norwegian headers (`dag`, `øvelse`, `sett`, `rutine`, `kommentar`), and reads a
set count out of the exercise cell itself if you wrote `Squat 5x5`.

**Markdown / plain text**

```markdown
# GZCLP

## Day A
- Barbell Back Squat 5x3+
- Bench Press 3x10

## Day B
- Deadlift 5x3
```

`#` names the routine, `##` a day, and each bullet an exercise. A trailing `5x3`
sets the number of sets and the rest becomes a note. A bare list with no headings
becomes a one-day routine, and `Day A:` works as a heading too.

Routines carry **structure only** — exercise order and how many sets. Nothing is
prescribed; the note is shown while you lift but never enforced.

Exercises are matched against your library case-insensitively. A near-miss asks
whether it's the same lift, and remembers your answer as an alias so the next
import of the same file matches silently.

## Exporting

Settings → Data.

- **JSON backup** — the whole database. This is the one that restores exactly.
- **CSV log** — one row per logged set, with `volume_kg`, `e1rm_kg` and
  `rest_before_sec` already computed so it is useful in a spreadsheet without
  writing formulas. Unticked planned sets are excluded.

Both go through the iOS share sheet, so you can drop them into Files, iCloud
Drive, or mail them to yourself.

Set **Spreadsheet format → `a; b`** if your Excel expects semicolons and comma
decimals; it switches both together, which is what makes the file parse.

## How the numbers work

- **Volume** — weight × reps, warm-ups excluded. Assistance (a negative weight on
  assisted pull-ups) clamps to zero rather than subtracting.
- **Estimated 1RM** — when a set carries an RPE or RIR, the standard RPE chart is
  used, which is far more accurate on heavy low-rep sets than any rep formula.
  Without one it falls back to Epley or Brzycki, your choice.
- **Records** — flagged against everything logged before that set, including
  earlier sets the same day. The first working set of a lift is a baseline, not a
  record, and warm-ups never count.
- **Rest** — derived from the timestamp on each set, so it appears in history and
  the CSV without there ever being a timer to start.

## Development

```bash
npm install
npm run dev
```

| Command | |
|---|---|
| `npm run dev` | dev server on :5173 |
| `npm test` | parser, metrics and round-trip tests |
| `npm run build` | typecheck + production build |
| `npm run icons` | regenerate app icons from `scripts/generate-icons.mjs` |

**Layout.** `src/core/` holds pure logic — metrics, importers, exporters — with
no React and no database access, which is what makes it testable. `src/db/`
wraps Dexie. `src/screens/` and `src/components/` are the UI. `src/platform/`
isolates the browser-specific parts (share sheet, file picker), so a Capacitor
native wrapper could be added later without touching the rest.

**Storage.** Everything lives in IndexedDB on the device. iOS clears storage for
websites unused for about a week, but apps added to the home screen are exempt.
Export a backup occasionally anyway — the app nudges you after five sessions.
