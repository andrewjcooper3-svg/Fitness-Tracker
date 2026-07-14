# Workout Tracker — Weekly Update Handoff

Paste this whole document into a new Claude chat, attach the current
`Workout_Tracker_AutoLog.html`, and fill in "Changes this week" at the
bottom before sending.

## What this file is

A single-page HTML workout tracker. It has two parts:
1. **The workout plan** (exercise names, sets/reps/weight targets, day
   layout) — this is what changes week to week.
2. **Auto-log wiring** (JavaScript + a bit of CSS) that POSTs completed
   workouts to a Google Sheet when "Generate Session Summary" is
   clicked. This must NOT change — it's already deployed and working.

Your job each week is part 1 only.

## DO NOT MODIFY

- The entire `<script>...</script>` block.
- The entire `<style>...</style>` block (unless I explicitly ask for a
  visual/design change).
- The "⚙ Google Sheet Sync" config box markup (the `div.config-box`
  near the top of `<body>`), including `id="deploymentUrl"`,
  `id="configStatus"`, `id="configBody"`, `id="configChevron"`.
- The seven day-panel ids (`day-mon`, `day-tue`, `day-wed`, `day-thu`,
  `day-fri`, `day-sat`, `day-sun`) and their `data-pushup-target`
  attributes (165 for every day except Saturday, which is 110).
- These class names, used by the JS to find and log data — don't
  rename, remove, or restructure them: `exercise-card`,
  `exercise-header`, `exercise-toggle`, `exercise-name`,
  `exercise-meta`, `exercise-sets`, `set-row`, `set-num`,
  `set-input-group`, `set-input-label`, `set-input`, `set-checkbox`,
  `check-item`, `checkbox`, `item-body`, `item-name`, `item-meta`.
- The `onclick` handlers already on elements (`toggleExercise(this)`,
  `toggleSetCheck(this)`, `toggleCheck(this)`).
- Don't hand-add "+ Add Set" / "+ Add Exercise" buttons — those are
  injected automatically by the script when the page loads.

## SAFE TO EDIT

Inside each `<div id="day-XXX" class="day-panel">...</div>`:

- Add, remove, or reorder `.exercise-card` blocks.
- Change exercise names, target weight/reps, number of sets.
- Change the day's badge/label (Gym/Home/Travel), alert text, and any
  non-exercise checklist items (`.check-item`, e.g. "Book InBody Scan").
- Update the header subtitle (e.g. "Balanced Growth - 100% Lean").

## Exercise card structure (copy this shape for edits/additions)

```html
<div class="exercise-card">
  <div class="exercise-header" onclick="toggleExercise(this)"><div class="exercise-toggle">▸</div><div class="exercise-name">EXERCISE NAME</div><div class="exercise-meta">WEIGHT · SETS × REPS</div></div>
  <div class="exercise-sets">
    <div class="set-row"><div class="set-num">1</div><div class="set-input-group"><div class="set-input-label">Weight</div><input class="set-input" type="text" placeholder="TARGET WEIGHT"></div><div class="set-input-group"><div class="set-input-label">Reps</div><input class="set-input" type="text" placeholder="TARGET REPS"></div><div class="set-input-group"><div class="set-input-label">Notes</div><input class="set-input" type="text"></div><div class="set-checkbox" onclick="toggleSetCheck(this)"></div></div>
    <!-- one .set-row per set, set-num incrementing -->
  </div>
</div>
```

Rules:
- Every `.set-row` needs exactly 3 `.set-input` fields in this order:
  Weight, Reps, Notes — plus one `.set-checkbox`.
- The **first** set-row's Weight/Reps placeholders are read as the
  "target" values that get logged to the Sheet — keep them accurate to
  the prescribed plan.
- Pushups must stay its own `.exercise-card` (bodyweight, sets × reps),
  not a separate input — this keeps it logging the same way as every
  other exercise. Its 3-sets-of-N breakdown should sum to the day's
  pushup target (165 weekdays/Sunday, 110 Saturday).

## Verification before you hand it back

Please confirm:
- [ ] `<script>` and `<style>` blocks are byte-for-byte unchanged
- [ ] Every set-row still has exactly 3 `.set-input`s + 1 `.set-checkbox`
- [ ] The config box and its ids are untouched
- [ ] All 7 day-panel ids and `data-pushup-target` attributes are present
- [ ] Pushups still appears as an `.exercise-card` on every day, summing
      to that day's target

---

## Changes this week

_(fill in, then send)_

- Day: _____ — Exercise: _____ → _____
- Day: _____ — Exercise: _____ → _____
-

**Notes from last week's Sheet data (optional):**
-
