/* The commitments shading: what you are paying for, and until when.

   It lives on the projection chart itself: a wash across the years each
   commitment covers, and nothing drawn underneath competing with the curve.
   The two things that used to go wrong, and are pinned here:
     - the slabs were opaque enough to drown the median line they were meant
       to explain, and
     - every child's label sat on one shared baseline, so two children born a
       few years apart printed one name straight through the other.

   What is checked here is mostly what a colour validator cannot see:
     - the three child stages are three DISTINCT fills in ordinal order
       (daycare -> school -> college is an order, so the ramp has to carry
       it monotonically, not just be "three colours"),
     - a mortgage and a car loan each span their real term,
     - a lease runs on for good and a cash purchase does not pretend to,
     - identity never rests on the fill alone - two of these sit under 3:1 on
       the light surface, so the legend and the read-out have to name what is
       shaded, and the read-out has to cover the house and the car rather
       than only the children,
     - the washes line up with the years they describe, on the same scale as
       the curve, or reading a dip down to its cause is a lie,
     - and the washes stay washes: faint, and behind the projection. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const Y = new Date().getFullYear();
const BASE = {
  age: 31, netWorth: 48000, gross: 95000, taxRate: 16, k401: 8, match: 4, monthly: 3200,
  creep: 50, credit: 750, inflation: 2.5, raiseNom: 3, promoNom: 8, promoMin: 1, promoMax: 1.5,
  promoStretch: 25, promoUntil: 50, pCash: 15, pBrok: 25, pRet: 60, toCash: 20, cashReal: 0.5,
  brokDrag: 0.4, retireTax: 15, gainsTax: 15, retireProfile: 'standard', retireSpend: 60000,
  stopWork: 62, retireAge: 62, runTo: 95, ssAnnual: 36000, ssAge: 67, savedAt: '',
  marketProfile: 'balanced', realReturn: 3.2, vol: 11,
  promos: [], rewards: [], kids: [], buys: []
};

// sRGB -> OKLCH lightness, so "is this a real ordinal ramp" is measured, not
// eyeballed. Same transform the palette validator uses.
const okL = rgb => {
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
};
const parse = css => (css.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

const openFin = async page => {
  await page.waitForFunction(() => typeof showAppView === 'function'
    && typeof finLanes_ === 'function', null, { timeout: 15000 });
  await page.evaluate(() => showAppView('financial'));
  await page.waitForFunction(() => /median/.test(
    document.getElementById('finReadout').textContent || ''), null, { timeout: 15000 });
  await page.waitForTimeout(350);
};

// What is actually on the chart: the washes, the marker row, and the legend.
const strip = page => page.evaluate(() => {
  const svg = document.getElementById('finCone');
  const vb = svg.getAttribute('viewBox').split(' ').map(Number);
  const all = [...svg.querySelectorAll('rect:not(.chart-hit)')].map(r => ({
    x: +r.getAttribute('x'), w: +r.getAttribute('width'), y: +r.getAttribute('y'),
    h: +r.getAttribute('height'), op: +(r.getAttribute('opacity') || 1),
    fill: getComputedStyle(r).fill,
    idx: [...svg.children].indexOf(r)
  }));
  // A wash spans most of the plot's height; a marker dot is 6px square below it.
  const tall = all.filter(r => r.h > vb[3] * 0.4);
  return {
    vh: vb[3],
    labels: [...svg.querySelectorAll('text')].map(t => t.textContent),
    rects: all.filter(r => r.h <= vb[3] * 0.4 && r.w > 0),
    washes: tall,
    line: [...svg.children].findIndex(c => c.tagName === 'path'),
    legend: [...document.querySelectorAll('#finLegend .hx-key')].map(k => k.textContent.trim()),
    hits: svg.querySelectorAll('.chart-hit').length
  };
});

async function load(page, over) {
  await page.addInitScript(s => localStorage.setItem('FINANCIAL_FUTURE_STATE', JSON.stringify(s)),
    Object.assign({}, BASE, over));
  await page.goto(URL);
  await page.waitForTimeout(800);
  await openFin(page);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [w, h, tag] of [[430, 932, 'phone'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} (${w}x${h}) ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

    console.log('-- nothing to show, nothing shaded --');
    await load(page, {});
    let s = await strip(page);
    check('an empty plan shades nothing', s.washes.length === 0 && s.rects.length === 0,
      `${s.washes.length} washes, ${s.rects.length} bars`);

    console.log('\n-- a child, in three stages --');
    await load(page, { kids: [{ label: 'Robin', birthYear: Y + 4, plan: 'public' }] });
    s = await strip(page);
    // Fills come off the washes; nothing is drawn below the plot any more.
    const kid = s.washes.slice().sort((a, b) => a.x - b.x);
    check('three stages, three separate washes', kid.length === 3, `${kid.length}`);
    const fills = kid.map(r => r.fill);
    check('and three DISTINCT fills, not one colour at three opacities',
      new Set(fills).size === 3, fills.join(' | '));
    check('nothing is drawn below the plot to compete with the curve',
      s.rects.length === 0, `${s.rects.length} marks below the plot`);
    /* Daycare -> school -> college is an ORDER. A ramp that is merely three
       different colours loses that; the lightness has to move one way. */
    const Ls = kid.map(r => okL(parse(r.fill)));
    const mono = Ls.every((v, i) => i === 0 || v > Ls[i - 1]) || Ls.every((v, i) => i === 0 || v < Ls[i - 1]);
    check('the ramp reads as an order, monotone in lightness', mono,
      Ls.map(v => v.toFixed(3)).join(' -> '));
    /* The washes are the point of "overlay it on one chart", and the reason
       the first attempt failed: three of them stack, so each has to be faint
       enough that the projection still wins. */
    check('and the washes are faint, not slabs', s.washes.every(w => w.op <= 0.15),
      s.washes.map(w => w.op).join(', '));
    check('the projection is drawn over them, never under',
      s.washes.every(w => w.idx < s.line) && s.line > -1,
      `line at ${s.line}, washes at ${s.washes.map(w => w.idx).join(',')}`);

    // Widths follow the real brackets: 0-5, 5-18, 18-22.
    check('school is the longest stage and college the shortest',
      kid[1].w > kid[0].w && kid[1].w > kid[2].w,
      kid.map(r => Math.round(r.w)).join(' / '));

    console.log('\n-- the house and the car span their terms --');
    await load(page, {
      buys: [
        { kind: 'house', label: 'House', year: Y + 3, price: 420000, plan: 'c20',
          down: 84000, rate: 6, term: 30, growth: 1, pmi: 0 },
        { kind: 'car', label: 'Car', mode: 'finance', year: Y + 2, price: 34000,
          down: 5000, rate: 6, term: 5, lease: 550, used: 0 }
      ]
    });
    s = await strip(page);
    const bars = s.washes.slice().sort((a, b) => b.w - a.w);
    check('two commitments shaded', bars.length === 2, `${bars.length}`);
    // 30 years against 5, on the same scale, out of a 64-year window.
    check('the mortgage is about six times the car loan',
      bars[0].w / bars[1].w > 4.5 && bars[0].w / bars[1].w < 8,
      `${Math.round(bars[0].w)} vs ${Math.round(bars[1].w)} px`);
    check('house and car are different colours', bars[0].fill !== bars[1].fill,
      `${bars[0].fill} | ${bars[1].fill}`);
    check('the legend names what is drawn, and nothing else',
      s.legend.join().includes('Property') && s.legend.join().includes('Vehicle')
      && !s.legend.join().includes('College'),
      s.legend.join(', '));

    console.log('\n-- a lease never stops, cash is a moment --');
    await load(page, {
      buys: [{ kind: 'car', label: 'Leased', mode: 'lease', year: Y + 2, price: 34000,
               down: 0, rate: 6, term: 5, lease: 550, used: 0 }]
    });
    let lease = (await strip(page)).washes[0];
    await load(page, {
      buys: [{ kind: 'car', label: 'Bought', mode: 'cash', year: Y + 2, price: 34000,
               down: 0, rate: 6, term: 5, lease: 550, used: 0 }]
    });
    let cash = (await strip(page)).washes[0];
    check('the lease runs on to the end of the plan', lease.w > cash.w * 20,
      `lease ${Math.round(lease.w)}px vs cash ${Math.round(cash.w)}px`);
    check('and the cash purchase is still visible rather than zero-width', cash.w >= 3,
      `${cash.w}px`);

    console.log('\n-- the shading lines up with the curve --');
    await load(page, {
      kids: [{ label: 'Robin', birthYear: Y + 4, plan: 'public' }],
      buys: [{ kind: 'house', label: 'House', year: Y + 3, price: 420000, plan: 'c20',
               down: 84000, rate: 6, term: 30, growth: 1, pmi: 0 }]
    });
    /* The house is bought three years out and the mortgage runs 30 years. Its
       wash has to start where that age sits on the curve's own scale - if the
       two ever drift, reading a dip down to its cause becomes a lie. Loaded
       here rather than inherited: the previous case left a cash car in place,
       and a check that silently measures the wrong scenario is worse than no
       check at all. */
    await load(page, {
      buys: [{ kind: 'house', label: 'House', year: Y + 3, price: 420000, plan: 'c20',
               down: 84000, rate: 6, term: 30, growth: 1, pmi: 0 }]
    });
    s = await strip(page);
    const aligned = await page.evaluate(() => {
      const svg = document.getElementById('finCone');
      const vb = svg.getAttribute('viewBox').split(' ').map(Number);
      const x0 = 46, x1 = vb[2] - 8;
      const at = age => x0 + (x1 - x0) * ((age - FIN.age) / (FIN.runTo - FIN.age));
      // :not(.chart-hit) matters - the hover targets are full-height too, and
      // the first one starts half a band left of the axis, so without this the
      // check quietly measures a transparent rectangle instead of a wash.
      const wash = [...svg.querySelectorAll('rect:not(.chart-hit)')]
        .filter(r => +r.getAttribute('height') > vb[3] * 0.4)
        .sort((a, b) => +a.getAttribute('x') - +b.getAttribute('x'))[0];
      const houseAge = FIN.age + (FIN.buys[0].year - FIN_YEAR0);
      return { want: at(houseAge), got: +wash.getAttribute('x'),
               wantEnd: at(houseAge + 30), gotEnd: +wash.getAttribute('x') + +wash.getAttribute('width') };
    });
    check('the wash starts on the year the mortgage does',
      Math.abs(aligned.want - aligned.got) < 1.5,
      `${aligned.got.toFixed(1)} vs ${aligned.want.toFixed(1)}`);
    check('and ends on the year it is paid off',
      Math.abs(aligned.wantEnd - aligned.gotEnd) < 1.5,
      `${aligned.gotEnd.toFixed(1)} vs ${aligned.wantEnd.toFixed(1)}`);
    check('the median line is still drawn', s.line > -1);

    console.log('\n-- one chart, one readout, covering everything --');
    /* The readout is the only place the numbers behind the shading are
       legible, so it has to name the house and the car too - not only the
       children, which is all it used to do. */
    await load(page, {
      kids: [{ label: 'Robin', birthYear: Y + 4, plan: 'public' }],
      buys: [{ kind: 'house', label: 'House', year: Y + 3, price: 420000, plan: 'c20',
               down: 84000, rate: 6, term: 30, growth: 1, pmi: 0 }]
    });
    const read = await page.evaluate(() => {
      // Age 45: Robin is at school and the mortgage is still running.
      const list = finCommitmentsAt_(45);
      return list.join(' | ');
    });
    check('a year names every commitment running in it',
      /Robin/.test(read) && /House/.test(read), read);
    check('and says what each is costing that year', (read.match(/\$/g) || []).length >= 2, read);

    check('the panel does not scroll sideways', !(await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)));

    // The washes stop at the plot, never bleeding over the age axis.
    const fits = await page.evaluate(() => {
      const svg = document.getElementById('finCone');
      const vb = svg.getAttribute('viewBox').split(' ').map(Number);
      const low = Math.max(0, ...[...svg.querySelectorAll('rect:not(.chart-hit)')]
        .map(r => +r.getAttribute('y') + +r.getAttribute('height')));
      const axis = Math.max(...[...svg.querySelectorAll('text')].map(t => +t.getAttribute('y')));
      return { low, axis, h: vb[3] };
    });
    check('the shading stops above the age axis', fits.low < fits.axis,
      `shading ends at ${fits.low}, axis text at ${fits.axis}`);

    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
