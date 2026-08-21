// AJC Fitness - iPhone home-screen widget (Scriptable)
//
// Reads the summary the app publishes to the Apps Script backend and draws
// it. See widget/README.md for setup.
//
// Why it reads a precomputed summary rather than the raw data: the peak
// model (temperature, ratio, flour, and this starter's own calibration)
// lives in the app, and reimplementing it here would guarantee the two
// disagree the next time it changes. The app publishes what it already
// computed; this file is layout only.
//
// Everything time-related in the summary is an absolute timestamp, and the
// countdowns below are worked out at draw time. iOS refreshes a widget on
// its own schedule - roughly every 15-60 minutes, and it throttles ones
// you never tap - so a countdown baked in by the app would be stale before
// you read it.

// ---------------------------------------------------------------------------
// PASTE YOUR DEPLOYMENT URL HERE (the same /exec URL the app uses - it is in
// the app under Settings). It must end in /exec.
const DEPLOYMENT_URL = '';
// Opens when you tap the widget. Leave as-is to open the app on GitHub Pages,
// or point it at wherever you open the tracker from.
const OPEN_URL = 'https://andrewjcooper3-svg.github.io/Fitness-Tracker/Workout_Tracker_AutoLog.html';
// ---------------------------------------------------------------------------

const C = {
  bg:      new Color('#12151c'),
  surface: new Color('#1a1f2b'),
  text:    new Color('#e8eaf0'),
  muted:   new Color('#8b93a7'),
  accent:  new Color('#6b8afd'),
  green:   new Color('#33c2a0'),
  amber:   new Color('#d9a441'),
  red:     new Color('#ef5b6b'),
  teal:    new Color('#33c2c2')
};

const LEVEL_COLOR = { ok: C.green, soon: C.amber, due: C.amber, overdue: C.red };

// Loads as text and parses here rather than using loadJSON(), which fails
// with a bare "The data couldn't be read because it isn't in the correct
// format" for every possible cause. Apps Script answers with an HTML page
// in several situations - not authorised, wrong URL, a thrown exception -
// and knowing WHICH is the whole difference between a two-minute fix and
// an afternoon.
async function fetchSummary() {
  if (!DEPLOYMENT_URL) throw new Error('Set DEPLOYMENT_URL at the top of this script.');
  if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(DEPLOYMENT_URL)) {
    throw new Error(DEPLOYMENT_URL.endsWith('/dev')
      ? 'That is the /dev URL. It only works while you are signed into the Apps Script editor - use the /exec one from Deploy > Manage deployments.'
      : 'DEPLOYMENT_URL does not look like an Apps Script web app URL. It should start https://script.google.com/ and end /exec.');
  }

  // Cache-busted: Apps Script serves reads through a redirect a browser is
  // happy to reuse, and a cached read is indistinguishable from "nothing
  // changed since this morning".
  const req = new Request(`${DEPLOYMENT_URL}?action=widgetSummary&t=${Date.now()}`);
  req.timeoutInterval = 20;
  const body = await req.loadString();
  const status = (req.response && req.response.statusCode) || 0;

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error(explainNonJson(body, status));
  }

  // A deployment that predates this endpoint ignores the action and answers
  // with its bare status page, which is valid JSON but not an answer.
  if (data && data.status === 'ok' && data.backendVersion) {
    throw new Error(`This deployment (${data.backendVersion}) predates the widget endpoint. Redeploy code.gs: Deploy > Manage deployments > edit > New version.`);
  }
  if (!data || data.status !== 'success') throw new Error((data && data.message) || 'Backend refused the request');
  if (!data.summary) throw new Error('Nothing published yet - open the tracker once so it can publish.');
  return data.summary;
}

function explainNonJson(body, status) {
  const b = String(body || '');
  if (!b.trim()) return `Empty reply (HTTP ${status}). Check the deployment is still live.`;

  // Google's sign-in / permission interstitial. Almost always the cause:
  // the web app was deployed with "Who has access" left on Only myself.
  if (/accounts\.google\.com|ServiceLogin|Sign in|signin\/v2/i.test(b)) {
    return 'Google is asking this URL to sign in. In Apps Script: Deploy > Manage deployments > edit > set "Who has access" to Anyone, then Deploy.';
  }
  if (/Authorization is required|needs? permission|requires authorization/i.test(b)) {
    return 'The deployment needs authorising. Open the /exec URL in Safari once, approve it, then try again.';
  }
  // An exception inside doGet - Apps Script renders it as an HTML page.
  const err = b.match(/(?:Exception|Error|TypeError|ReferenceError)[^<>\n]{0,160}/i);
  if (err) return 'The backend threw: ' + err[0].trim();
  if (/Script function not found|not found/i.test(b)) {
    return 'Apps Script could not find the web app. Re-check the /exec URL.';
  }
  if (/^\s*<(!doctype|html)/i.test(b)) {
    return `Got an HTML page instead of data (HTTP ${status}). Open the /exec URL in Safari to see what it says.`;
  }
  return `Unreadable reply (HTTP ${status}): ${b.slice(0, 120)}`;
}

// "in 50m" / "3h 20m ago" - the widget's own clock, not the app's.
function rel(iso, now) {
  if (!iso) return '';
  const mins = Math.round((new Date(iso) - now) / 60000);
  const a = Math.abs(mins);
  const txt = a < 60 ? `${a}m` : (a % 60 === 0 ? `${a / 60}h` : `${Math.floor(a / 60)}h ${a % 60}m`);
  return mins >= 0 ? `in ${txt}` : `${txt} ago`;
}

function clock(iso) {
  if (!iso) return '';
  const f = new DateFormatter();
  f.dateFormat = 'h:mm a';
  return f.string(new Date(iso));
}

// Starter headline, worked out here so it reflects the time right now
// rather than whenever the app last published.
function starterLines(s, now) {
  if (!s || s.stage === 'none') return { title: 'No starter', sub: 'Start one in the app', color: C.muted };
  if (s.stage === 'building') return { title: s.headline, sub: s.sub || '', color: C.accent };
  if (s.level === 'none') return { title: 'No feeds yet', sub: 'Log its first feed', color: C.muted };

  const color = LEVEL_COLOR[s.level] || C.muted;
  if (s.level === 'overdue' || s.level === 'due') {
    return { title: 'Feed it', sub: s.fedAt ? `Fed ${rel(s.fedAt, now)}` : '', color };
  }
  const peak = s.peakAt ? new Date(s.peakAt) : null;
  if (peak && peak > now) {
    return { title: `Peaks ${clock(s.peakAt)}`, sub: rel(s.peakAt, now) + ' · use it at the dome', color };
  }
  if (s.dueAt) {
    return { title: peak ? `Peaked ${clock(s.peakAt)}` : 'On the counter',
             sub: `Next feed ${rel(s.dueAt, now)}`, color };
  }
  return { title: 'On the counter', sub: '', color };
}

// DrawContext has no fillRoundedRect - rounded corners come from a Path.
// (fillRect and fillEllipse are the only shape helpers on the context
// itself.)
function fillRounded(dc, rect, radius) {
  const p = new Path();
  p.addRoundedRect(rect, radius, radius);
  dc.addPath(p);
  dc.fillPath();
}

function bar(w, pct, color, width, height) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const r = height / 2;
  dc.setFillColor(new Color('#ffffff', 0.13));
  fillRounded(dc, new Rect(0, 0, width, height), r);
  const fill = Math.max(0, Math.min(1, pct)) * width;
  if (fill > 0) {
    dc.setFillColor(color);
    fillRounded(dc, new Rect(0, 0, Math.max(fill, height), height), r);
  }
  const img = w.addImage(dc.getImage());
  img.imageSize = new Size(width, height);
  return img;
}

function label(stack, text, size, color, bold) {
  const t = stack.addText(text);
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
  return t;
}

function header(w, text, color) {
  const row = w.addStack();
  row.centerAlignContent();
  const dot = row.addText('●');
  dot.font = Font.systemFont(8);
  dot.textColor = color;
  row.addSpacer(5);
  label(row, text.toUpperCase(), 10, C.muted, true);
}

function starterBlock(w, s, now, big) {
  const L = starterLines(s, now);
  header(w, 'Starter', L.color);
  w.addSpacer(4);
  label(w, L.title, big ? 20 : 16, C.text, true);
  if (L.sub) { w.addSpacer(2); label(w, L.sub, big ? 12 : 11, C.muted); }
}

function pushupBlock(w, p, width) {
  if (!p) return;
  header(w, 'Pushups this week', C.accent);
  w.addSpacer(4);
  const row = w.addStack();
  row.centerAlignContent();
  label(row, p.done.toLocaleString(), 18, C.text, true);
  row.addSpacer(5);
  // Same three numbers as the app: done / planned now / planned this week,
  // collapsing to two when the week's workouts match what was planned.
  const planned = p.plannedNow === p.plannedWeek
    ? `of ${p.plannedNow.toLocaleString()}`
    : `of ${p.plannedNow.toLocaleString()} · ${p.plannedWeek.toLocaleString()} planned`;
  label(row, planned, 11, C.muted);
  w.addSpacer(5);
  bar(w, p.plannedNow ? p.done / p.plannedNow : 0, C.accent, width, 6);
}

function waterBlock(w, water, width) {
  if (!water) return;
  header(w, 'Water', C.teal);
  w.addSpacer(4);
  const row = w.addStack();
  row.centerAlignContent();
  label(row, String(water.oz), 18, C.text, true);
  row.addSpacer(5);
  label(row, `of ${water.goal} oz`, 11, C.muted);
  w.addSpacer(5);
  bar(w, water.goal ? water.oz / water.goal : 0, C.teal, width, 6);
}

function shell() {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);
  w.url = OPEN_URL;
  // A hint, not a guarantee - iOS decides when it actually reloads.
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

function errorWidget(err) {
  const w = shell();
  header(w, 'AJC Fitness', C.red);
  w.addSpacer(6);
  const t = w.addText(String(err.message || err));
  t.font = Font.systemFont(11);
  t.textColor = C.muted;
  t.lineLimit = 4;
  return w;
}

function build(summary, family) {
  const now = new Date();
  const w = shell();

  if (family === 'small') {
    // One thing, the one with a deadline.
    starterBlock(w, summary.starter, now, false);
    w.addSpacer();
    if (summary.pushups) {
      const row = w.addStack();
      row.centerAlignContent();
      label(row, `${summary.pushups.done.toLocaleString()} pushups`, 11, C.muted);
    }
    if (summary.water) label(w, `${summary.water.oz} of ${summary.water.goal} oz`, 11, C.muted);
    return w;
  }

  if (family === 'large') {
    starterBlock(w, summary.starter, now, true);
    w.addSpacer(12);
    pushupBlock(w, summary.pushups, 300);
    w.addSpacer(12);
    waterBlock(w, summary.water, 300);
    w.addSpacer();
    label(w, 'Updated ' + clock(summary.updatedAt), 9, C.muted);
    return w;
  }

  // medium: starter on the left, the two bars on the right
  const cols = w.addStack();
  cols.layoutHorizontally();
  cols.topAlignContent();

  const left = cols.addStack();
  left.layoutVertically();
  left.size = new Size(140, 0);
  starterBlock(left, summary.starter, now, false);

  cols.addSpacer(14);

  const right = cols.addStack();
  right.layoutVertically();
  pushupBlock(right, summary.pushups, 150);
  right.addSpacer(10);
  waterBlock(right, summary.water, 150);
  return w;
}

let widget;
try {
  const summary = await fetchSummary();
  widget = build(summary, config.widgetFamily || 'medium');
} catch (err) {
  widget = errorWidget(err);
}

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // Run it inside Scriptable to preview.
  await widget.presentMedium();
}
Script.complete();
