# Workout Tracker — Weekly Update Handoff

Reference notes for the weekly training review done in this session/repo
(Claude Code, with direct write access to `Workout_Tracker_AutoLog.html`
and GitHub Pages hosting it live). Kept here so the ground rules survive
even if this conversation gets summarized or a future session picks the
repo back up.

## What this file is

A single-page HTML workout tracker, hosted via GitHub Pages. It has two
parts:
1. **The workout plan** (exercise names, sets/reps/weight targets, day
   layout) — this is what gets updated week to week.
2. **Auto-log wiring** (JavaScript + a bit of CSS) that POSTs completed
   workouts to a Google Sheet when "Generate Session Summary" is
   clicked. This must NOT change — it's already deployed and working.

## The role

Act as trainer: review the logged data from this past week and decide
the next week's plan, the way a coach would after reviewing a client's
training log — not just apply changes the user dictates. Apply those
decisions directly to the HTML (following the rules below), commit and
push so the hosted page updates, and explain the reasoning afterward.

Use web search where it actually informs a judgment call (progressive
overload rates, deload timing, rep ranges for hypertrophy vs. strength,
etc.) and say what it's based on. For anything that reads as pain, injury,
or needing a real diagnosis rather than normal training fatigue, flag it
instead of programming around it — that's a "see a professional" case,
not a research-citation case.

## What's needed each week

- This week's data from the Sheet: the current week's tab, either
  exported as CSV or its rows pasted in (Timestamp, Day, Exercise, Target
  Weight, Target Reps, Sets Completed, Sets Planned, Total Reps, Notes).

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
  that exercise or add a corrective, using judgment (and research where
  relevant).
- No data logged for a day/exercise (skipped session) → leave it as-is
  and call that out explicitly in the summary rather than guessing.
- Pushups: adjust the sets-of-N breakdown if the weekly total is
  consistently over/under target, keeping the set count reasonable (2-4
  sets) and the total matching that day's `data-pushup-target`.

If the data is ambiguous or it's unclear whether to progress something,
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

## Before pushing an update

Confirm, then give a plain-text summary of what changed and why (per
exercise), so there's a clear record of what to expect walking into the
week:

- [ ] `<script>` and `<style>` blocks are byte-for-byte unchanged
- [ ] Every set-row still has exactly 3 `.set-input`s + 1 `.set-checkbox`
- [ ] The config box and its ids are untouched
- [ ] All 7 day-panel ids and `data-pushup-target` attributes are present
- [ ] Pushups still appears as an `.exercise-card` on every day, summing
      to that day's target
- [ ] Committed and pushed so the GitHub Pages link reflects the update
