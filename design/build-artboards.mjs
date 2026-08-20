// Regenerates one .dc.html design artboard per app tab, straight from the
// real app rather than hand-drawn.
//
// Why generate: hand-authoring six views at fidelity is both a lot of work
// and immediately stale. This loads Workout_Tracker_AutoLog.html in a real
// browser at landscape-phone size with the iPhone's safe-area insets
// applied, switches to each tab, and lifts the rendered markup plus the
// app's own stylesheet into an artboard. What you see on the canvas is
// what the app actually renders. Re-run it after changing the app.
//
//   node design/build-artboards.mjs
//
// Then re-seed and publish the canvas (see design/README-ish notes in the
// commit history, or just run seed-canvas.mjs with every *.dc.html).
//
// Three things have to be faked because an artboard is an iframe, not a
// phone: env(safe-area-inset-*) is always 0 in an iframe, 100vh is the
// iframe's height rather than the screen's, and position:fixed would
// escape to the iframe viewport. See ARTBOARD_OVERRIDES below.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..', 'Workout_Tracker_AutoLog.html');

// iPhone 17 Pro Max, landscape.
const SCREEN_W = 932;
const SCREEN_H = 430;
const SIDE_INSET = 59;
const BEZEL = 20;

// The artboard iframe is the whole device, bezel included, so the media
// queries have to see a width inside the landscape tier (768-1099.98).
const FRAME_W = SCREEN_W + BEZEL * 2;
const FRAME_H = SCREEN_H + BEZEL * 2;

// file stem -> the app's view id suffix. Main is the entry artboard the
// canvas opens on; canvas.json renames it to "Trainer" for display.
const VIEWS = [
  { file: 'Overview', view: 'overview' },
  { file: 'Main',     view: 'tracker'  },
  { file: 'Kitchen',  view: 'kitchen'  },
  { file: 'Music',    view: 'music'    },
  { file: 'Calendar', view: 'calendar', seed: seedCalendar },
  { file: 'Stats',    view: 'stats'    },
];

// Calendar is the one tab with nothing to draw here - it reads iCloud
// through a Cloudflare Worker, so in a sandbox it captures as "Failed to
// fetch" and the artboard shows no layout at all. Feed the app's own
// renderer a few plausible events instead, so the tab is reviewable.
// Nothing else needs seeding: Music's disconnected state is a real state
// worth designing for, and Trainer/Overview/Kitchen/Stats draw from data
// baked into the page.
function seedCalendar() {
  const day = (offset, h, m) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  renderCalendarEvents([
    { start: day(0, 9, 0),  summary: 'Standup',                calendar: 'Work' },
    { start: day(0, 12, 30), summary: 'Lunch with Sam',        calendar: 'Personal' },
    { start: day(0, 18, 0), summary: 'Gym — Legs + Arms',      calendar: 'Fitness' },
    { start: day(1, 8, 30), summary: 'Dentist',                calendar: 'Personal' },
    { start: day(1, 14, 0), summary: 'Design review',          calendar: 'Work' },
    { start: day(2, 0, 0),  summary: 'Flight to Denver', allDay: true, calendar: 'Travel' },
    { start: day(3, 19, 30), summary: 'Dinner reservation',    calendar: 'Personal' },
  ]);
  const status = document.getElementById('calStatus');
  if (status) { status.className = 'cal-status'; status.textContent = ''; }
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The app styles `body` directly; inside an artboard `body` is the iframe's
// own body, which is the whole device including the bezel. Rebinding those
// rules onto a .app-body wrapper lets the phone chrome live outside the
// app's box. Matches inside comments get rewritten too - harmless.
const rebindBody = css => css.replace(/\bbody\b/g, '.app-body');

const ARTBOARD_OVERRIDES = `
  /* ---- artboard scaffolding (not part of the app) ---- */
  html, body { margin: 0; background: transparent; }

  .device {
    position: relative; width: ${FRAME_W}px; height: ${FRAME_H}px;
    box-sizing: border-box; padding: ${BEZEL}px;
    border-radius: {{cornerRadius}}px;
    background: linear-gradient(145deg, #6b6f76 0%, #2b2e33 22%, #45484e 50%, #2b2e33 78%, #6b6f76 100%);
    box-shadow: 0 18px 50px rgba(0,0,0,0.55);
  }

  /* The transform is load-bearing: it makes .screen the containing block
     for the app's position:fixed chrome (tab bar, edge chips, shuffle),
     which would otherwise pin to the iframe viewport and sit 20px out in
     the bezel. */
  .screen {
    position: relative; width: ${SCREEN_W}px; height: ${SCREEN_H}px;
    overflow: hidden; border-radius: {{screenRadius}}px;
    transform: translateZ(0);
    background: var(--bg);
  }

  /* The app's own box, standing in for <body> on the device. env() is
     always 0 in an iframe, so every inset is written out literally. */
  .app-body {
    position: absolute; inset: 0; overflow: hidden;
    box-sizing: border-box;
    max-width: none; margin: 0;
    padding: 56px {{sideInset}}px 10px {{sideInset}}px;
  }
  .app-body .app-tabs {
    left: {{sideInset}}px; right: {{sideInset}}px;
    padding: 0 8px;
  }
  /* 100vh is the iframe's height (device + bezel), not the screen's. */
  .app-body #view-tracker > .tracker-main-col,
  .app-body #view-tracker > .tracker-side-rail {
    max-height: ${SCREEN_H - 66}px;
  }
  .app-body .app-views-viewport { height: auto; max-width: none; }
  .app-body .app-view { display: block; width: 100%; }

  /* ---- safe-area overlay ---- */
  .gutter {
    position: absolute; top: 0; bottom: 0; width: {{sideInset}}px; z-index: 80;
    background: repeating-linear-gradient(45deg, rgba(239,91,107,0.13) 0px, rgba(239,91,107,0.13) 6px, transparent 6px, transparent 12px);
    pointer-events: none;
  }
  .gutter-l { left: 0; border-right: 1px dashed rgba(239,91,107,0.45); }
  .gutter-r { right: 0; border-left: 1px dashed rgba(239,91,107,0.45); }
  .gutter-lbl {
    position: absolute; left: 50%; top: 44px; transform: translateX(-50%) rotate(-90deg);
    white-space: nowrap; font-size: 9px; font-weight: 700; letter-spacing: 0.8px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    color: rgba(239,91,107,0.85);
  }

  /* ---- physical chrome, drawn over everything, reserving no space ---- */
  .island {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    width: 32px; height: 122px; border-radius: 16px; background: #000; z-index: 90;
  }
  .home-indicator {
    position: absolute; left: 50%; transform: translateX(-50%); bottom: 6px;
    width: 148px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.55); z-index: 90;
  }
`;

const PROPS = JSON.stringify({
  sideInset: { editor: 'range', default: SIDE_INSET, min: 0, max: 90, step: 1, unit: 'px', section: 'Safe area' },
  showSafeArea: { editor: 'boolean', default: true, section: 'Safe area' },
  screenRadius: { editor: 'range', default: 54, min: 0, max: 80, step: 1, unit: 'px', section: 'Device' },
  cornerRadius: { editor: 'range', default: 72, min: 0, max: 100, step: 1, unit: 'px', section: 'Device' },
  $preview: { width: FRAME_W, height: FRAME_H },
});

const artboard = ({ label, css, markup }) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
${css}
  </style>
</helmet>

<!-- ${label} - generated by design/build-artboards.mjs from the live app.
     Edit freely here; port whatever you keep back into
     Workout_Tracker_AutoLog.html, since a rebuild overwrites this file. -->
<div class="device">
  <div class="screen">
${markup}
    <sc-if value="{{showSafeArea}}" hint-placeholder-val="{{ true }}">
      <div class="gutter gutter-l"><div class="gutter-lbl">SAFE AREA</div></div>
      <div class="gutter gutter-r"><div class="gutter-lbl">SAFE AREA</div></div>
    </sc-if>
    <div class="island"></div>
    <div class="home-indicator"></div>
  </div>
</div>
</x-dc>

<script data-dc-script data-props='${PROPS}'>
class Component extends DCLogic {
  renderVals() {
    return {
      sideInset: this.props.sideInset ?? ${SIDE_INSET},
      showSafeArea: this.props.showSafeArea ?? true,
      screenRadius: this.props.screenRadius ?? 54,
      cornerRadius: this.props.cornerRadius ?? 72
    };
  }
}
</script>
</body>
</html>
`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: FRAME_W, height: FRAME_H } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setSafeAreaInsetsOverride', {
  insets: { top: 0, left: SIDE_INSET, right: SIDE_INSET, bottom: 21 },
});
await page.goto('file://' + APP);
await page.waitForTimeout(900);

const appCss = await page.evaluate(() =>
  [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));

const built = [];
for (const { file, view, seed } of VIEWS) {
  await page.evaluate(v => showAppView(v), view);
  await page.waitForTimeout(650);
  if (seed) { await page.evaluate(seed); await page.waitForTimeout(150); }

  const markup = await page.evaluate((viewId) => {
    // Interactivity is dead in a static artboard, so drop every handler
    // rather than leaving clicks that throw ReferenceError in the console.
    const clean = (el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('script').forEach(s => s.remove());
      for (const n of [c, ...c.querySelectorAll('*')]) {
        for (const a of [...n.attributes]) {
          if (a.name.startsWith('on')) n.removeAttribute(a.name);
        }
      }
      return c;
    };

    const viewEl = document.getElementById('view-' + viewId);
    const v = clean(viewEl);
    // Trainer carries all seven day panels; only the visible one matters
    // on the canvas, and dropping six of them takes the artboard from
    // ~122KB to a size that's pleasant to edit.
    v.querySelectorAll('.day-panel:not(.active)').forEach(p => p.remove());

    const parts = [clean(document.querySelector('.app-tabs')).outerHTML, v.outerHTML];
    // .ov-grid and .sp-shuffle-fab live at body level, not inside the view.
    for (const sel of ['.ov-grid', '.sp-shuffle-fab']) {
      const el = document.querySelector(sel);
      if (el && getComputedStyle(el).display !== 'none') parts.push(clean(el).outerHTML);
    }
    return { html: parts.join('\n'), bodyClass: document.body.className };
  }, view);

  const indented = markup.html.split('\n').map(l => '      ' + l).join('\n');
  const inner = `    <div class="app-body ${markup.bodyClass}">\n${indented}\n    </div>`;

  const css = ['  ' + rebindBody(appCss).split('\n').join('\n  '), ARTBOARD_OVERRIDES].join('\n');
  const out = resolve(HERE, `${file}.dc.html`);
  writeFileSync(out, artboard({ label: view, css, markup: inner }));
  built.push(`${file}.dc.html (${(out.length, Buffer.byteLength(artboard({ label: view, css, markup: inner })) / 1024).toFixed(0)}KB)`);
}

await browser.close();
console.log('built:\n  ' + built.join('\n  '));
