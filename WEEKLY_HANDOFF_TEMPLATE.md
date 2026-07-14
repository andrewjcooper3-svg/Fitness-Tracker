# Workout Tracker — Weekly Update Handoff

Paste this whole document into a new Claude chat along with the current
`Workout_Tracker_AutoLog.html` and this week's logged data from the
Google Sheet (export the current week's tab as CSV, or copy/paste the
rows — see "What to bring" below).

## What this file is

A single-page HTML workout tracker. It has two parts:
1. **The workout plan** (exercise names, sets/reps/weight targets, day
   layout) — this is what you, acting as my trainer, update week to week.
2. **Auto-log wiring** (JavaScript + a bit of CSS) that POSTs completed
   workouts to a Google Sheet when "Generate Session Summary" is
   clicked. This must NOT change — it's already deployed and working.

## Your role

Act as my trainer. I'm not going to tell you what to change — review the
logged data from this past week and decide the next week's plan yourself,
the way a coach would after reviewing a client's training log. Then apply
those decisions directly to the HTML (following the rules below) and
explain your reasoning afterward.

## What to bring to the chat

- The current `Workout_Tracker_AutoLog.html`.
- This week's data: either the Sheet tab exported as CSV, or the rows
  copy/pasted (Timestamp, Day, Exercise, Target Weight, Target Reps, Sets
  Completed, Sets Planned, Total Reps, Notes).

## How to decide progression

For each exercise, look at Sets Completed vs. Sets Planned, Total Reps vs.
target, and any Notes (pain, fatigue, "felt easy," left/right imbalance,
etc.), then use ordinary progressive-overload judgment:
- Cleanly hit all sets at target weight/reps → progress it: a small
  weight increase (roughly 2.5-10 lb depending on the lift) or an added
  rep/set next week.
- Missed sets or reps, or notes mention strain/pain → hold at the current
  weight, or back off slightly; don't progress an exercise the log shows
  struggling.
- Notes flag something specific (e.g. "left arm still lagging") → adjust
  that exercise or add a corrective, using your judgment.
- No data logged for a day/exercise (skipped session) → leave it as-is
  and call that out explicitly in your summary rather than guessing.
- Pushups: adjust the sets-of-N breakdown if the weekly total is
  consistently over/under target, keeping the set count reasonable (2-4
  sets) and the total matching that day's `data-pushup-target`.

If the data is ambiguous or you're unsure whether to progress something,
say so and ask rather than guessing.

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

Please confirm, then give me a plain-text summary of what changed and
why (per exercise), so I know what to expect walking into the week:

- [ ] `<script>` and `<style>` blocks are byte-for-byte unchanged
- [ ] Every set-row still has exactly 3 `.set-input`s + 1 `.set-checkbox`
- [ ] The config box and its ids are untouched
- [ ] All 7 day-panel ids and `data-pushup-target` attributes are present
- [ ] Pushups still appears as an `.exercise-card` on every day, summing
      to that day's target
