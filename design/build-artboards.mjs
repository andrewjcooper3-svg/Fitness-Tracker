// Regenerates the design canvas artboards straight from the real app:
// every tab, in every form factor.
//
// Why generate rather than draw: hand-authoring this many views at
// fidelity is both a lot of work and immediately stale. This loads
// Workout_Tracker_AutoLog.html in a real browser at each target size,
// switches to each tab, and lifts the rendered markup plus the app's own
// stylesheet into an artboard. What you see on the canvas is what the app
// actually renders. Re-run after changing the app:
//
//   node design/build-artboards.mjs
//
// Four things have to be faked, because an artboard is an iframe and not a
// device. Each is written out literally in the per-form-factor overrides:
//   1. env(safe-area-inset-*) is always 0 in an iframe.
//   2. 100vh is the iframe's height, which includes the bezel.
//   3. position:fixed would escape past the bezel to the iframe viewport
//      (a transform on the screen div scopes it back).
//   4. The app styles `body`, which here is the whole device including
//      chrome - so those rules get rebound onto an .app-body wrapper.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..', 'Workout_Tracker_AutoLog.html');

// Hatched safe-area bands. Deliberately heavy: these are meant to read as
// space the phone has taken away, not as a subtle tint, so anything that
// strays into one is obvious at a glance.
const HATCH = `
    background-color: rgba(239,91,107,0.10);
    background-image: repeating-linear-gradient(45deg, rgba(239,91,107,0.30) 0px, rgba(239,91,107,0.30) 5px, transparent 5px, transparent 11px);`;

const FORM_FACTORS = [
  {
    id: 'landscape',
    label: 'iPhone landscape',
    suffix: '',                    // landscape keeps the original file names
    screen: { w: 932, h: 430 },
    bezel: 20,
    deviceRadius: 72,
    screenRadius: 54,
    insets: { top: 0, right: 59, bottom: 21, left: 59 },
    // The app gives the home-indicator strip back to content in landscape,
    // so the app box uses a flat 10px bottom gutter, not the inset.
    appBox: 'padding: 56px 59px 10px 59px;',
    tabBar: 'left: 59px; right: 59px; padding: 0 8px;',
    vhFix: '.app-body #view-tracker > .tracker-main-col,\n  .app-body #view-tracker > .tracker-side-rail { max-height: 364px; }',
    chrome: `
  .band-l, .band-r { position: absolute; top: 0; bottom: 0; width: 59px; z-index: 80; pointer-events: none;${HATCH} }
  .band-l { left: 0; border-right: 1px dashed rgba(239,91,107,0.6); }
  .band-r { right: 0; border-left: 1px dashed rgba(239,91,107,0.6); }
  .band-lbl { position: absolute; left: 50%; top: 44px; transform: translateX(-50%) rotate(-90deg); }
  .island { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 32px; height: 122px; border-radius: 16px; background: #000; z-index: 90; }
  .home-ind { position: absolute; left: 50%; transform: translateX(-50%); bottom: 6px; width: 148px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.55); z-index: 90; }`,
    bands: '<div class="band-l"><div class="band-lbl safe-lbl">SAFE AREA</div></div>\n      <div class="band-r"><div class="band-lbl safe-lbl">SAFE AREA</div></div>',
  },
  {
    id: 'portrait',
    label: 'iPhone portrait',
    suffix: 'Portrait',
    screen: { w: 440, h: 956 },
    bezel: 18,
    deviceRadius: 72,
    screenRadius: 55,
    insets: { top: 62, right: 0, bottom: 34, left: 0 },
    appBox: 'padding: 118px 12px 58px 12px;',
    tabBar: 'left: 0; right: 0; padding: 62px 6px 0;',
    vhFix: '',                     // the split-column tier never applies here
    chrome: `
  .band-t { position: absolute; left: 0; right: 0; top: 0; height: 62px; z-index: 80; pointer-events: none;${HATCH} border-bottom: 1px dashed rgba(239,91,107,0.6); }
  .band-b { position: absolute; left: 0; right: 0; bottom: 0; height: 34px; z-index: 80; pointer-events: none;${HATCH} border-top: 1px dashed rgba(239,91,107,0.6); }
  .band-lbl { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
  .island { position: absolute; left: 50%; transform: translateX(-50%); top: 11px; width: 122px; height: 32px; border-radius: 16px; background: #000; z-index: 90; }
  .home-ind { position: absolute; left: 50%; transform: translateX(-50%); bottom: 8px; width: 138px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.55); z-index: 90; }`,
    bands: '<div class="band-t"><div class="band-lbl safe-lbl">SAFE AREA</div></div>\n      <div class="band-b"><div class="band-lbl safe-lbl">SAFE AREA</div></div>',
  },
  {
    id: 'web',
    label: 'Desktop browser',
    suffix: 'Web',
    screen: { w: 1440, h: 900 },
    bezel: 0,
    chromeBarH: 40,               // browser toolbar drawn above the viewport
    deviceRadius: 12,
    screenRadius: 0,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    // No safe areas on the web, and the desktop tier already sets its own
    // body padding - crucially a left gutter that clears the fixed 220px
    // sidebar. Overriding padding here would slide the whole app under it.
    appBox: '',
    tabBar: '',
    vhFix: '',
    chrome: `
  .browser-bar {
    position: absolute; left: 0; right: 0; top: 0; height: 40px; z-index: 90;
    display: flex; align-items: center; gap: 8px; padding: 0 14px; box-sizing: border-box;
    background: #e9e8e4; border-bottom: 1px solid rgba(0,0,0,0.12);
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .dot-r { background: #ff5f57; } .dot-y { background: #febc2e; } .dot-g { background: #28c840; }
  .url-pill {
    flex: 1; height: 24px; margin-left: 10px; border-radius: 12px; background: #fff;
    border: 1px solid rgba(0,0,0,0.1); display: flex; align-items: center; padding: 0 12px;
    font: 500 11px/1 -apple-system, BlinkMacSystemFont, sans-serif; color: #6b7280;
  }`,
    bands: '',
  },
];

// file stem -> the app's view id. Main is the entry artboard.
const VIEWS = [
  { file: 'Overview', view: 'overview' },
  { file: 'Main',     view: 'tracker'  },
  { file: 'Kitchen',  view: 'kitchen'  },
  { file: 'Music',    view: 'music'    },
  { file: 'Calendar', view: 'calendar' },
  { file: 'Stats',    view: 'stats'    },
];

// Calendar is the one tab with nothing to draw here - it reads iCloud
// through a Cloudflare Worker, so in a sandbox it captures as "Failed to
// fetch" and the artboard shows no layout at all. Feed the app's own
// renderer a few plausible events instead. Nothing else needs seeding:
// Music's disconnected state is a real state worth designing for, and the
// rest draw from data baked into the page.
function seedCalendar() {
  const day = (offset, h, m) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  renderCalendarEvents([
    { start: day(0, 9, 0),   summary: 'Standup',             calendar: 'Work' },
    { start: day(0, 12, 30), summary: 'Lunch with Sam',      calendar: 'Personal' },
    { start: day(0, 18, 0),  summary: 'Gym — Legs + Arms',   calendar: 'Fitness' },
    { start: day(1, 8, 30),  summary: 'Dentist',             calendar: 'Personal' },
    { start: day(1, 14, 0),  summary: 'Design review',       calendar: 'Work' },
    { start: day(2, 0, 0),   summary: 'Flight to Denver', allDay: true, calendar: 'Travel' },
    { start: day(3, 19, 30), summary: 'Dinner reservation',  calendar: 'Personal' },
  ]);
  const status = document.getElementById('calStatus');
  if (status) { status.className = 'cal-status'; status.textContent = ''; }
}
VIEWS.find(v => v.view === 'calendar').seed = seedCalendar;

// Matches inside comments get rewritten too - harmless, they don't render.
const rebindBody = css => css.replace(/\bbody\b/g, '.app-body');

const overrides = (ff) => {
  const frameW = ff.screen.w + ff.bezel * 2;
  const frameH = ff.screen.h + ff.bezel * 2 + (ff.chromeBarH || 0);
  return `
  /* ---- artboard scaffolding (not part of the app) ---- */
  html, body { margin: 0; background: transparent; }

  .device {
    position: relative; width: ${frameW}px; height: ${frameH}px;
    box-sizing: border-box; padding: ${ff.bezel}px; padding-top: ${ff.bezel + (ff.chromeBarH || 0)}px;
    border-radius: ${ff.deviceRadius}px;
    background: ${ff.id === 'web'
      ? '#d6d4cf'
      : "linear-gradient(145deg, #6b6f76 0%, #2b2e33 22%, #45484e 50%, #2b2e33 78%, #6b6f76 100%)"};
    box-shadow: 0 18px 50px rgba(0,0,0,0.55);
    overflow: hidden;
  }

  /* The transform is load-bearing: it makes .screen the containing block
     for the app's position:fixed chrome, which would otherwise pin to the
     iframe viewport and sit outside the screen entirely. */
  .screen {
    position: relative; width: ${ff.screen.w}px; height: ${ff.screen.h}px;
    overflow: hidden; border-radius: ${ff.screenRadius}px;
    transform: translateZ(0);
    background: var(--bg);
  }

  /* The app's own box, standing in for <body> on the device. */
  .app-body {
    position: absolute; inset: 0; overflow: hidden;
    box-sizing: border-box;
    max-width: none; margin: 0;
    ${ff.appBox}
  }
  ${ff.tabBar ? `.app-body .app-tabs { ${ff.tabBar} }` : ''}
  ${ff.vhFix}
  .app-body .app-views-viewport { height: auto; }
  .app-body .app-view { display: block; width: 100%; }

  .safe-lbl {
    white-space: nowrap; font-size: 9px; font-weight: 700; letter-spacing: 0.8px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    color: rgba(239,91,107,0.95);
  }
${ff.chrome}
`;
};

const esc = s => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');

const artboard = ({ ff, view, css, markup }) => {
  const props = JSON.stringify({
    $preview: {
      width: ff.screen.w + ff.bezel * 2,
      height: ff.screen.h + ff.bezel * 2 + (ff.chromeBarH || 0),
    },
  });
  const chromeMarkup = ff.id === 'web'
    ? `    <div class="browser-bar"><div class="dot dot-r"></div><div class="dot dot-y"></div><div class="dot dot-g"></div><div class="url-pill">fitness-tracker.local</div></div>`
    : `    <div class="island"></div>\n    <div class="home-ind"></div>`;

  return `<!doctype html>
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

<!-- ${view} / ${ff.label} - generated by design/build-artboards.mjs from
     the live app. Edit freely here; port whatever you keep back into
     Workout_Tracker_AutoLog.html, since a rebuild overwrites this file. -->
<div class="device">
${ff.id === 'web' ? chromeMarkup + '\n' : ''}  <div class="screen">
${markup}
${ff.bands ? '      ' + ff.bands : ''}
${ff.id === 'web' ? '' : chromeMarkup}
  </div>
</div>
</x-dc>

<script data-dc-script data-props='${esc(props)}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const built = [];
const manifest = [];

for (const ff of FORM_FACTORS) {
  const frameW = ff.screen.w + ff.bezel * 2;
  const frameH = ff.screen.h + ff.bezel * 2 + (ff.chromeBarH || 0);

  const ctx = await browser.newContext({ viewport: { width: frameW, height: frameH } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: ff.insets });
  await page.goto('file://' + APP);
  await page.waitForTimeout(2200); // past the launch splash

  const appCss = await page.evaluate(() =>
    [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'));
  const css = ['  ' + rebindBody(appCss).split('\n').join('\n  '), overrides(ff)].join('\n');

  for (const { file, view, seed } of VIEWS) {
    await page.evaluate(v => showAppView(v), view);
    await page.waitForTimeout(600);
    if (seed) { await page.evaluate(seed); await page.waitForTimeout(150); }

    const captured = await page.evaluate((viewId) => {
      // Interactivity is dead in a static artboard, so drop every handler
      // rather than leaving clicks that throw in the console.
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
      // on a canvas, and dropping six keeps the artboard editable.
      v.querySelectorAll('.day-panel:not(.active)').forEach(p => p.remove());

      const parts = [];
      // The tab bar and the desktop sidebar are alternatives - whichever
      // this width actually shows is the one worth capturing. The stat
      // chips and shuffle button are pulled in only when they live OUTSIDE
      // the view: .ov-grid is a descendant of the Trainer rail, so on that
      // tab it already arrives inside v and copying it again would stack a
      // second (invisible in landscape, very visible in portrait) copy.
      for (const sel of ['.app-tabs', '.app-sidebar', '.ov-grid', '.sp-shuffle-fab']) {
        const el = document.querySelector(sel);
        if (!el || getComputedStyle(el).display === 'none') continue;
        if (viewEl.contains(el)) continue;
        parts.push(clean(el).outerHTML);
      }
      parts.splice(parts.length, 0, v.outerHTML);
      return { html: parts.join('\n'), bodyClass: document.body.className };
    }, view);

    const indented = captured.html.split('\n').map(l => '      ' + l).join('\n');
    const markup = `    <div class="app-body ${captured.bodyClass}">\n${indented}\n    </div>`;
    const stem = file + ff.suffix;
    const html = artboard({ ff, view, css, markup });
    writeFileSync(resolve(HERE, `${stem}.dc.html`), html);
    built.push(`${stem}.dc.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)}KB`);
    manifest.push({ stem, view, ff: ff.id, w: frameW, h: frameH });
  }
  await ctx.close();
}

await browser.close();
writeFileSync(resolve(HERE, 'artboards.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('built:\n  ' + built.join('\n  '));
