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

**8. Put it on the Lock Screen too.** This is the one worth doing. Long-press
the Lock Screen → **Customise** → tap the area under the clock (or the small
slots above it) → **Scriptable** → set **Script** to *AJC Fitness*. Three
shapes are supported and each is a different amount of detail:

| Slot | Shows |
|---|---|
| **Circular** (small, above or below the clock) | A ring of today's pushup progress with the number left in the middle. |
| **Rectangular** (the wide slot under the clock) | `110 pushups to go`, the week strip as dots, and the next lift. |
| **Inline** (the one line above the clock) | `110 pushups to go`. |

## What it shows

**Pushups today leads everything**, because that is the number you can still
act on. `110 to go of 165`, or a green ✓ once the day is done, or `Rest day`
on Sunday. The week total moved down to the large widget.

Underneath it, **a dot per day, Monday first**:

| Mark | Means |
|---|---|
| ● filled green | that day's target was met |
| ◐ amber | started but not finished |
| ○ hollow | hasn't happened yet |
| ○ red | in the past, and missed |
| · faint | nothing was planned (Sunday) |
| ring around it | today |

A missed day and a day that hasn't happened yet deliberately look different —
otherwise every Monday morning reads as a week of failure.

| | |
|---|---|
| **Next lift** | `Lift today · Leg Press · Leg Curl · RDL` on a gym day, `Next lift Wednesday` otherwise. Worked out from the plan, so it follows a change to the split rather than assuming Mon/Wed. |
| **Starter** | `Peaks 5:28 PM · in 50m` while it is climbing, `Feed it · fed 9h ago` once it is due, the build-day count while it is still being built. The dot is green/amber/red to match the app. Small drops the header and keeps one line — pushups took that space. |
| **Pushups this week** | Large only now. Done, then `of 990 · 1,045 planned`. |
| **Water** | Today's ounces against the goal. |

## Things worth knowing

**The pushup targets come from the plan, not a constant.** Saturday is 220
because the plan runs four sets there; Sunday is 0. Change the plan and the
dots follow it.

**Lock Screen widgets are tinted near-monochrome by iOS**, so the ring and
the dots are drawn to read by shape and brightness rather than colour. That
is why the rectangular slot uses text marks (● ✕ ○) instead of the drawn
dot strip the home screen gets.

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

The widget reads the reply as text and parses it itself, rather than using
Scriptable's `loadJSON()` — that reports every possible cause as the same
unhelpful *"The data couldn't be read because it isn't in the correct
format."* Apps Script answers with an HTML page in several situations, and
knowing which one is the whole difference between a two-minute fix and an
afternoon.

| Message | What it means |
|---|---|
| `Set DEPLOYMENT_URL at the top of this script.` | Step 5. |
| `DEPLOYMENT_URL does not look like an Apps Script web app URL.` | It must start `https://script.google.com/` and end `/exec`. |
| `That is the /dev URL.` | `/dev` only works while you are signed into the editor. Use the `/exec` one from Deploy → Manage deployments. |
| `Google is asking this URL to sign in.` | The web app's **Who has access** is not *Anyone*. Deploy → Manage deployments → edit → set it → Deploy. This is the usual cause. |
| `The deployment needs authorising.` | Open the `/exec` URL in Safari once and approve it. |
| `This deployment (…) predates the widget endpoint.` | Step 1 — redeploy `code.gs`. |
| `The backend threw: …` | An exception inside `doGet`; the message is Apps Script's own. |
| `Got an HTML page instead of data (HTTP …)` | Open the `/exec` URL in Safari to see what Google is actually returning. |
| `Nothing published yet - open the tracker once…` | The backend is fine, it just has nothing stored. |
| `The internet connection appears to be offline.` | The phone could not reach Apps Script. |

**Quickest check of all:** paste your `/exec` URL into Safari with
`?action=widgetSummary` on the end. You should see a line of JSON starting
`{"status":"success"`. Anything else — a sign-in page, an error page — is
the actual problem, shown directly.

## Testing it without a phone

`test_widget_strict.mjs` runs the real `AJC-Fitness.js` against
`scriptable-stub.mjs` — a stub of the Scriptable API that **throws on
anything the real API does not have**.

```
node widget/test_widget_strict.mjs
```

That strictness is the point. An earlier, permissive stub happily answered
to `DrawContext.fillRoundedRect`, which Scriptable has no such method for,
so the tests passed and the phone threw. A stub that answers to anything
proves nothing.
