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

1. Each day (Mon–Sun) has a panel with exercise cards (sets/reps/weight
   inputs + a checkbox per completed set) or a simpler pushup/cardio
   checklist for non-gym days.
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

## Data logged per exercise

Each exercise in a session is logged as its own row:

`Timestamp | Day | Exercise | Target Weight | Target Reps | Sets Completed | Sets Planned | Pushups Completed | Notes`

Target weight/reps come from the placeholders on the first set of each
exercise (the prescribed target); sets completed is the count of checked
set checkboxes; notes are pulled from any per-set notes fields entered
during the session.

Days with no structured exercises (pure pushup or cardio days) log a
single summary row instead.

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
