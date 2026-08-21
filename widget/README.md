# iPhone home-screen widget

A Scriptable widget showing the sourdough starter's clock, this week's
pushups and today's water. No Xcode, no Mac, no Apple Developer account.

![sizes](#) Small shows the starter alone; medium puts the starter beside
the two bars; large stacks all three.

## Setup

**1. Redeploy `code.gs`.** The widget reads an endpoint added in
`2026-08-22-widget-summary`. In the Apps Script editor: paste the current
`code.gs`, then **Deploy → Manage deployments → edit (pencil) → Version:
New version → Deploy**. Use *edit an existing deployment*, not "New
deployment" — a new deployment gets a new URL and the app would still be
talking to the old one.

**2. Open the tracker once** on any device. The app computes the summary
and publishes it; until it has, the widget will say so rather than showing
stale numbers.

**3. Install Scriptable** from the App Store (free).

**4. Add the script.** Open Scriptable → **+** (top right) → paste the
contents of `AJC-Fitness.js` → tap the script name at the top and call it
**AJC Fitness** → Done.

**5. Set your URL.** At the top of the script, put your deployment URL in
`DEPLOYMENT_URL` — the same `/exec` URL the app uses (it is in the app
under the gear icon → Settings). It must end in `/exec`.

**6. Preview it.** Tap ▶ inside Scriptable. You should see the widget. If
something is wrong it tells you what, in plain text, instead of failing
silently.

**7. Put it on the home screen.** Long-press the home screen → **+** (top
left) → search **Scriptable** → pick a size → **Add Widget**. Then
long-press the new widget → **Edit Widget** → set **Script** to *AJC
Fitness*. Leave "When Interacting" as *Run Script* to open the tracker on
tap.

## What it shows

| | |
|---|---|
| **Starter** | `Peaks 5:28 PM · in 50m` while it is climbing, `Feed it · fed 9h ago` once it is due, the build-day count while it is still being built. The dot is green/amber/red to match the app. |
| **Pushups** | Done, then `of 990 · 1,045 planned` — the same done / planned-now / planned-this-week the app shows, collapsing to one number when the week's workouts match the plan. |
| **Water** | Today's ounces against the goal. |

## Things worth knowing

**Refresh is iOS's decision, not the widget's.** Roughly every 15–60
minutes, and iOS throttles widgets you never interact with. The script asks
for 15 minutes; that is a hint, not a promise.

Because of that, **nothing time-related is baked in by the app**. It
publishes absolute timestamps (`peakAt`, `dueAt`) and the widget works out
"in 50m" when it draws. So the countdown is right even when the underlying
data was fetched an hour ago — it drifts only if a *new feed* happens
without a refresh.

**It is read-only.** A Scriptable widget cannot have buttons; tapping opens
the tracker. If you want one-tap logging from the home screen, that is a
Shortcut posting to the backend (the same way weigh-ins already do), added
as a Shortcuts widget.

**The peak model stays in the app.** The widget deliberately does no
forecasting of its own — it draws a summary the app already computed.
Otherwise the two would disagree the next time the model changes.

**The endpoint is unauthenticated**, as it has been since setup: anyone
with the URL can read the summary. The widget just puts another copy of
that URL on your phone.

## If it shows an error

| Message | What it means |
|---|---|
| `Set DEPLOYMENT_URL at the top of this script.` | Step 5. |
| `Nothing published yet - open the app once.` | Step 2 — the backend is fine, it just has nothing stored. |
| `Unknown action "widgetSummary" … needs redeploying.` | Step 1 — the deployment predates the endpoint. |
| `The internet connection appears to be offline.` | The phone could not reach Apps Script. |
