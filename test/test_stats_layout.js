const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve('/home/user/Fitness-Tracker/Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const seed = page => page.evaluate(() => {
  const log = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.now() - i * 3 * 86400000);
    log.push({ date: d.toISOString().slice(0, 10), weight: 186 - i * 0.4 + (i % 3) * 0.6, bodyFat: null });
  }
  localStorage.setItem('WORKOUT_WEIGHT_LOG', JSON.stringify(log));
  showAppView('stats');
  renderStatsTab();
});

// The whole bug in one number: getScreenCTM().a is the horizontal scale
// and .d the vertical. Stretched, a/d was 3.4 on desktop - which is
// exactly how much the text was smeared sideways.
const probe = page => page.evaluate(() => {
  const out = {};
  ['statsPushupChart', 'statsWeightChart'].forEach(id => {
    const svg = document.getElementById(id);
    const m = svg.getScreenCTM();
    const r = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox');
    out[id] = {
      scaleX: Math.round(m.a * 1000) / 1000,
      scaleY: Math.round(m.d * 1000) / 1000,
      viewBox: vb,
      pxW: Math.round(r.width),
      par: svg.getAttribute('preserveAspectRatio')
    };
  });
  // The two absorbed cards are now the last children of the Overview
  // section, packed into its column flow.
  const all = [...document.querySelectorAll('#hxSectionOverview > .stats-card')];
  const cards = all.slice(-2).map(c => {
    const r = c.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) };
  });
  const columns = new Set(all.map(c => Math.round(c.getBoundingClientRect().left))).size;
  return { out, cards, columns, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [w, h, tag] of [[430, 932, 'portrait'], [932, 430, 'landscape'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} (${w}x${h}) ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.goto(URL);
    await page.waitForTimeout(900);
    await seed(page);
    await page.waitForTimeout(600);

    const p = await probe(page);
    Object.entries(p.out).forEach(([id, v]) => {
      console.log(`  ${id}:`, JSON.stringify(v));
      check(`${id} scales uniformly (no stretch)`, Math.abs(v.scaleX - v.scaleY) < 0.02, `x=${v.scaleX} y=${v.scaleY}`);
      check(`${id} draws 1 unit = 1 pixel`, Math.abs(v.scaleX - 1) < 0.02, String(v.scaleX));
      check(`${id} viewBox matches its pixel width`, v.viewBox.split(' ')[2] === String(v.pxW), `${v.viewBox} vs ${v.pxW}px`);
      check(`${id} no longer forces preserveAspectRatio`, v.par === null, String(v.par));
    });

    // The two absorbed cards are packed into the Overview's column flow now,
    // so what matters is that the flow goes multi-column on a wide screen -
    // not that these particular two land next to each other.
    console.log('  cards:', JSON.stringify(p.cards), '| columns:', p.columns);
    if (w >= 768) check('the overview runs more than one column', p.columns >= 2, String(p.columns));
    else check('one column in portrait', p.columns === 1, String(p.columns));
    check('no horizontal page overflow', !p.pageOverflow);

    // The x-axis is drawn inside the SVG now, so each date label is a <text>
    // that must be centred on its own column. (This used to be an HTML row
    // flexed under the chart, which is exactly what kept drifting.)
    const align = await page.evaluate(() => {
      const svg = document.getElementById('statsPushupChart');
      const cols = [...svg.querySelectorAll('path[fill]')];
      // The date labels are the bottom row of ticks; y-axis ticks sit higher.
      const ticks = [...svg.querySelectorAll('.chart-tick')];
      const maxY = Math.max(...ticks.map(t => +t.getAttribute('y')));
      const dates = ticks.filter(t => +t.getAttribute('y') === maxY);
      if (!cols.length) return { mismatch: 'no columns drawn' };
      const worst = cols.reduce((mx, c) => {
        const cb = c.getBBox(), mid = cb.x + cb.width / 2;
        const near = dates.reduce((best, d) =>
          Math.abs(+d.getAttribute('x') - mid) < Math.abs(+best.getAttribute('x') - mid) ? d : best, dates[0]);
        return Math.max(mx, Math.abs(+near.getAttribute('x') - mid));
      }, 0);
      return { columns: cols.length, dateLabels: dates.length, worstOffsetPx: Math.round(worst * 10) / 10 };
    });
    console.log('  column/label alignment:', JSON.stringify(align));
    check('every column has a date label centred on it',
      !align.mismatch && align.dateLabels >= align.columns && align.worstOffsetPx <= 1,
      JSON.stringify(align));

    await ctx.close();
  }

  console.log('\n=== Redraws on resize rather than rescaling ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.goto(URL);
    await page.waitForTimeout(900);
    await seed(page);
    await page.waitForTimeout(500);
    const before = (await probe(page)).out.statsPushupChart;
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(900);
    const after = (await probe(page)).out.statsPushupChart;
    console.log('  before:', before.viewBox, '->', 'after:', after.viewBox);
    check('viewBox followed the new width', after.viewBox !== before.viewBox && after.viewBox.split(' ')[2] === String(after.pxW));
    check('still 1:1 after the resize', Math.abs(after.scaleX - 1) < 0.02 && Math.abs(after.scaleX - after.scaleY) < 0.02,
      `x=${after.scaleX} y=${after.scaleY}`);
    await ctx.close();
  }

  console.log('\n=== Empty weight trend collapses instead of leaving a void ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.goto(URL);
    await page.waitForTimeout(900);
    await page.evaluate(() => { localStorage.removeItem('WORKOUT_WEIGHT_LOG'); showAppView('stats'); renderStatsTab(); });
    await page.waitForTimeout(500);
    const empty = await page.evaluate(() => {
      const svg = document.getElementById('statsWeightChart');
      return { h: Math.round(svg.getBoundingClientRect().height),
               cardH: Math.round(svg.closest('.stats-card').getBoundingClientRect().height) };
    });
    console.log(' ', JSON.stringify(empty));
    check('empty chart takes no height', empty.h === 0, String(empty.h));
    check('and the card shrinks with it', empty.cardH < 130, String(empty.cardH));
    await ctx.close();
  }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
