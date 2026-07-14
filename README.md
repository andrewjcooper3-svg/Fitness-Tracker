# Fitness Tracker — Workout Plan + Google Sheets Auto-Log

A single-page HTML workout tracker (7-day plan: gym, home pushup days, and
a VO2 max cardio day) that auto-submits completed workout data to a Google
Sheet via a Google Apps Script web endpoint.

## Files

| File | Purpose |
|---|---|
| `Workout_Tracker_AutoLog.html` | The workout tracker UI. Open directly in a browser — no build step. |
| `code.gs` | Google Apps Script web endpoint (`doGet`/`doPost`) that appends workout rows to a Google Sheet. |
| `DEPLOYMENT_INSTRUCTIONS.txt` | Step-by-step guide to deploying the script and connecting it to the HTML page. |

## How it works

1. Each day (Mon–Sun) has a panel of exercise cards — sets/reps/weight
   inputs plus a checkbox per completed set. Pushups are logged the same
   way as any gym exercise (bodyweight, sets × reps), so every day's
   plan uses one consistent format.
2. Clicking **"Generate Session Summary"**:
   - Builds a plain-text summary (unchanged from the original tracker).
   - Builds a JSON payload of the day's data and POSTs it to the Apps
     Script deployment URL configured in the "⚙ Google Sheet Sync" box
     at the top of the page.
   - Shows a status line: `✓ Logged to Sheet`, an error with a retry
     button, or an offline notice.
3. The deployment URL is stored in the browser's `localStorage`, so it's
   configured once per device.
4. If a submission fails (offline or a network error), the payload is
   queued in `localStorage` and automatically retried the next time the
   page loads or the browser regains connectivity.
5. Every exercise card has a **"+ Add Set"** button to log an extra set
   beyond the plan, and every day has a **"+ Add Exercise"** button at
   the bottom of its Workouts list to log something not in the plan
   (tap the name field to name it). Both are picked up automatically by
   the summary and Sheet logging — no separate wiring needed.
6. Each exercise card shows a live **"Total: N reps"** line, summing the
   reps entered across all its sets. For Pushups this also shows the
   day's target (e.g. "Total: 96 / 165 reps"), so you can see running
   progress toward the daily goal as you log sets throughout the day.

## Data logged per set

Every individual set is logged as its own row — not just one summary row
per exercise — so a weight or rep change between sets (e.g. dropping
weight on set 3 due to fatigue) is preserved instead of averaged away:

`Timestamp | Day | Exercise | Set | Target Weight | Actual Weight | Target Reps | Actual Reps | Completed | Notes`

Target weight/reps come from the exercise's first-set placeholder (the
prescribed plan) and are repeated on every set row for that exercise so
each row is self-contained. Actual weight/reps use whatever was typed
into that specific set; if left blank, they fall back to the target
(assuming the plan was followed as-is). Completed reflects that set's
checkbox. Pushups log the same way as any gym lift — one row per set.

Days with no structured exercises (e.g. the Saturday cardio checklist
items) log a single placeholder row instead.

## Sheet organization

- The header shows the current Monday–Sunday range (e.g. "Week of Jul 13
  - Jul 19, 2026"), computed automatically from the device's date — no
  need to edit it by hand.
- Every submission includes that week label, and the Apps Script files
  the row into a Sheet **tab** named after it, creating the tab the first
  time a given week is logged. Reopen the same tracker file all week and
  everything lands in the same tab; get a fresh tracker next week and it
  starts a new tab automatically — all inside the same spreadsheet.
- Rows are tinted by day of week (Monday through Sunday each get a fixed
  pastel color) with a divider line where the day changes, so a week's
  tab is easy to scan at a glance.

## Setup

See `DEPLOYMENT_INSTRUCTIONS.txt` for the full walkthrough:
1. Paste `code.gs` into a new Apps Script project and deploy it as a
   web app ("Execute as: Me", "Who has access: Anyone").
2. Paste the resulting deployment URL into the config box at the top of
   `Workout_Tracker_AutoLog.html`.
3. Complete a workout and confirm a row appears in the generated
   "Workout Tracker Log" Google Sheet.

## Troubleshooting

See the **TROUBLESHOOTING** section of `DEPLOYMENT_INSTRUCTIONS.txt` for
common issues (missing URL, unreachable endpoint, stale deployments,
access errors).
