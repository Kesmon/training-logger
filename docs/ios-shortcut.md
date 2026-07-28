# Getting exports to your coach with fewer taps

The app cannot save files to a folder by itself. A web app on iOS has no
filesystem access and no background execution — Safari gives it neither, and
that is the price of an app that installs without a Mac, a developer account or
a weekly re-signing ritual.

What it *can* do is hand a file to the iOS share sheet. An **iOS Shortcut** can
sit in that sheet and put the file exactly where you want it, every time,
without you navigating anywhere.

**Without a Shortcut:** finish → Send to coach → Save to Files → find the folder
→ Save. Five taps, and a folder to pick correctly each time.

**With one:** finish → Send to coach → tap the Shortcut. Done.

> These steps are written from how Shortcuts works, but they have not been run on
> your phone. Menu wording moves slightly between iOS versions — if a label
> differs, the shape of the thing is still right.

---

## The one that matters

### 1. Make a folder for it

In **Files → iCloud Drive**, make a folder — `Training logs` will do.

If your coach uses iCloud, share it: long-press the folder → **Share** → invite
them with edit access. Then anything landing in it is visible to them without
you sending anything. If they don't, skip this and use the email variant below.

### 2. Build the Shortcut

Open **Shortcuts** → **+** to make a new one.

1. Add the action **Save File**.
2. It will default to saving *Shortcut Input* — that is the file the app hands
   over, so leave it.
3. Tap **Ask Where to Save** to turn it **off**. This is the step that removes
   the folder navigation.
4. Tap the destination and choose your `Training logs` folder.

Now make it appear in the share sheet:

5. Open the shortcut's **details** (the ⓘ or settings icon).
6. Turn on **Show in Share Sheet**.
7. Under the accepted types, leave **Files** on and turn the rest off — otherwise
   it clutters the sheet for photos and text.
8. Name it something you will recognise in a list: **Save to coach**.

### 3. Use it

Finish a session → **Send to coach** → the share sheet opens → tap **Save to
coach**.

The file lands in the folder under its own name — `training-log-2026-07-28-S1.csv`
— and the app never asks you anything else. Because the filename is derived from
the session, sending the same session twice replaces it rather than making a
second copy.

---

## Optional: email it instead

If your coach isn't on iCloud, swap step 2's **Save File** for **Send Email**:

- Set the recipient to their address
- Attach *Shortcut Input*
- Turn off **Show Compose Sheet** so it sends without another confirmation

Same two taps, the mail just leaves immediately. Worth keeping a **Save File**
action in the same shortcut as well, so you keep your own copy.

---

## Optional: a weekly nudge

A time-based automation is the closest thing to hands-off available here.

**Shortcuts → Automation → + → Time of Day.** Pick a day and time — Sunday
evening, before your coach plans the next block. Then add actions that read the
`Training logs` folder and email whatever is in it.

Turn off **Ask Before Running** so it fires on its own.

This does not export anything — the app has to be open for that. What it does is
make sure nothing sits in the folder unnoticed for a week.

---

## What is still not possible

Being straight about the ceiling, so you don't go looking for a setting that
isn't there:

- **Exporting without opening the app.** A PWA runs only while it is on screen.
  Nothing can trigger an export in the background.
- **Zero taps.** The share sheet needs one deliberate tap. That is an iOS
  security boundary, not an app limitation.
- **Watching a folder for new routines.** Import is a manual choose-a-file step
  in the same way, and for the same reason.

Genuinely unattended sync would mean adding a server and an account, and your
training data leaving the device. That is a different project, and worth
choosing deliberately rather than drifting into.

---

## Going the other way — receiving routines

No Shortcut needed. Your coach sends a `.md` or `.csv`; save it to Files
anywhere. In the app: **Settings → Import a routine → Choose a file**.

If they share the same iCloud folder, they can drop routines straight in and you
will see them in the picker without anything being sent at all.
