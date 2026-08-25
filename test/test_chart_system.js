/* The charts as one system rather than a dozen one-offs.

   Two classes of defect this guards:

   1. STRETCHED CHARTS. A viewBox fixed at 320 wide plus
      preserveAspectRatio="none" scales the drawing horizontally to fill its
      element - so on a wide card one unit across is not one unit down, and
      strokes fatten, dots go oval, glyphs smear. It is invisible on a phone
      and obvious on a desktop, which is exactly how it survives. Every
      chart that has drawn must measure 1:1.

   2. CHART INK PICKED FOR BUTTONS. The interface accents are chosen to sit
      on controls; on a chart surface several of them land outside the
      readable lightness band. The chart tokens are a separate, validated
      set, so this checks the charts actually use them and that the UI
      accents have stopped appearing as chart marks. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const ROWS = [];
for (let w = 0; w < 6; w++) {
  const d = new Date(Date.now() - w * 7 * 86400000);
  const date = d.toISOString().slice(0, 10);
  ROWS.push(
    { date, day: 'Monday', exercise: 'Leg Press', sets: 3, done: 3, topWeight: 255 - w,
      volume: 7000 + w * 90, targetReps: 10, totalReps: 30, green: 1, yellow: 2, red: 0, week: 'Week ' + w },
    { date, day: 'Monday', exercise: 'Pushups', sets: 3, done: 3, topWeight: 0,
      volume: 0, targetReps: 55, totalReps: 165, green: 3, yellow: 0, red: 0, week: 'Week ' + w });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('=== The chart palette is the validated one ===');
  {
    const src = fs.readFileSync(path.resolve(__dirname, '../Workout_Tracker_AutoLog.html'), 'utf8');
    ['--chart-1', '--chart-2', '--chart-good', '--chart-warn'].forEach(tok => {
      // Once for the dark root, once per light scope (media query + toggle).
      const n = (src.match(new RegExp(tok + ':', 'g')) || []).length;
      check(`${tok} is defined for dark and both light scopes`, n === 3, `${n} definitions`);
    });
    // The UI accents must no longer be painting chart marks.
    const marks = src.split('\n').filter(l =>
      /(fill|stroke)="?\$?\{?[^"]*var\(--(accent|green|amber|teal|purple)\)/.test(l)
      && !/--chart-/.test(l));
    check('no chart mark still wears a UI accent', marks.length === 0,
      marks.map(l => l.trim().slice(0, 70)).join(' // '));
  }

  for (const [w, h, tag] of [[430, 932, 'phone'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} (${w}x${h}) ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.addInitScript(rows => {
      localStorage.setItem('WORKOUT_HISTORY_CACHE', JSON.stringify({ rows, at: new Date().toISOString() }));
      const log = [];
      for (let i = 9; i >= 0; i--) {
        const d = new Date(Date.now() - i * 3 * 86400000);
        log.push({ date: d.toISOString().slice(0, 10), weight: 186 - i * 0.4, bodyFat: null });
      }
      localStorage.setItem('WORKOUT_WEIGHT_LOG', JSON.stringify(log));
    }, ROWS);
    await page.goto(URL);
    await page.waitForTimeout(900);
    await page.evaluate(() => { showAppView('stats'); renderStatsTab(); });
    await page.waitForTimeout(800);

    // Every chart that has actually drawn, wherever it lives.
    const drawn = await page.evaluate(() => [...document.querySelectorAll('svg.stats-chart, svg.ov-pu-chart, svg.wt-chart, svg.sd-chart-svg')]
      .filter(s => s.getBoundingClientRect().width > 20 && s.children.length)
      .map(s => {
        const m = s.getScreenCTM();
        return {
          id: s.id || '(anon)',
          ratio: Math.round((m.a / m.d) * 1000) / 1000,
          par: s.getAttribute('preserveAspectRatio'),
          width: Math.round(s.getBoundingClientRect().width)
        };
      }));
    console.log('  drawn: ' + drawn.map(d => `${d.id} ${d.ratio}x`).join(', '));
    check('at least one chart drew', drawn.length > 0, String(drawn.length));
    const skewed = drawn.filter(d => Math.abs(d.ratio - 1) > 0.02);
    check('no chart is drawn distorted', skewed.length === 0,
      skewed.map(d => `${d.id} ${d.ratio}x`).join(', '));
    const stretchy = drawn.filter(d => d.par === 'none');
    check('and none is left on preserveAspectRatio="none"', stretchy.length === 0,
      stretchy.map(d => d.id).join(', '));

    /* Axis labels must be distinct. A chart whose values top out at 1 was
       getting a 0.5 step, and because the tick formatter rounds, the axis
       read "1 / 1 / 0" - two identical labels at different heights, which
       is worse than no axis at all. */
    // The x-axis labels share the class, so the y ticks are picked out by
    // their end anchor - they are the only ones set flush against the axis.
    const dupes = await page.evaluate(() => [...document.querySelectorAll('svg.stats-chart')]
      .filter(s => s.children.length)
      .map(s => {
        const ys = [...s.querySelectorAll('text.chart-tick')]
          .filter(t => t.getAttribute('text-anchor') === 'end')
          .map(t => t.textContent.trim());
        return { id: s.id, ys, dupe: ys.length !== new Set(ys).size };
      }).filter(r => r.dupe));
    check('no chart repeats a y-axis label', dupes.length === 0,
      dupes.map(d => `${d.id}: ${d.ys.join('/')}`).join(', '));

    // The marks resolve to the validated hexes, not the interface accents.
    const resolved = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const tok = n => cs.getPropertyValue(n).trim().toLowerCase();
      const marks = [...document.querySelectorAll('svg.stats-chart path[fill], svg.stats-chart circle[fill]')]
        .map(el => el.getAttribute('fill').trim().toLowerCase())
        .filter(v => v && v !== 'none');
      return {
        chart1: tok('--chart-1'), good: tok('--chart-good'), warn: tok('--chart-warn'),
        accent: tok('--accent'), green: tok('--green'), amber: tok('--amber'),
        marks: [...new Set(marks)]
      };
    });
    const known = ['var(--chart-1)', 'var(--chart-good)', 'var(--chart-warn)', 'var(--chart-2)'];
    const stray = resolved.marks.filter(m => m.startsWith('var(') && !known.includes(m));
    check('chart fills come from the chart tokens', stray.length === 0, stray.join(', '));
    check('the chart hues are distinct from the UI accents',
      resolved.chart1 !== resolved.accent && resolved.good !== resolved.green
      && resolved.warn !== resolved.amber,
      `${resolved.chart1}/${resolved.accent} ${resolved.good}/${resolved.green} ${resolved.warn}/${resolved.amber}`);

    // Legend swatch and the mark it stands for must be the same ink.
    const legend = await page.evaluate(() => [...document.querySelectorAll('.hx-swatch')]
      .map(el => (el.getAttribute('style') || '').match(/var\(--[a-z0-9-]+\)/i))
      .filter(Boolean).map(m => m[0]));
    const badLegend = legend.filter(v => !known.includes(v) && v !== 'var(--red)');
    check('legend swatches use the same tokens as the marks', badLegend.length === 0,
      badLegend.join(', '));

    await ctx.close();
  }

  // Dark and light both have to be selected, not one flipped from the other.
  console.log('\n=== Both themes carry their own steps ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.goto(URL);
    await page.waitForTimeout(700);
    const read = () => page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return ['--chart-1', '--chart-2', '--chart-good', '--chart-warn']
        .map(n => cs.getPropertyValue(n).trim().toLowerCase());
    });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const dark = await read();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const light = await read();
    console.log('  dark :', dark.join(' '));
    console.log('  light:', light.join(' '));
    check('every slot is defined in dark', dark.every(Boolean), dark.join(' '));
    check('every slot is defined in light', light.every(Boolean), light.join(' '));
    check('the two themes are stepped differently',
      dark.every((v, i) => v !== light[i]), `${dark.join(' ')} vs ${light.join(' ')}`);
    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
