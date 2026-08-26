/* Selling a house.

   The easy version of this feature nets the sale against the mortgage and
   stops, which quietly hands you about 6% of a house that never existed and
   ignores the tax entirely. So what is checked here is the whole closing
   statement, one deduction at a time, against arithmetic worked out here:

     sale price - what is still owed - 6% to sell it
                - tax on the gain above the $250,000 exclusion

   plus the two things that have to STOP when the house goes: the mortgage
   payments and the upkeep. Forgetting either leaves you paying for a house
   you no longer own, and the error is invisible on the chart.

   One trap in reading these numbers back: a point on the series is the
   OPENING balance for that age, so the effect of selling at 55 is visible
   at 56. Reading the sale year itself shows the world before the sale. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };
const money = n => '$' + Math.round(n).toLocaleString();
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const Y = new Date().getFullYear();
// Nothing on but the house: no income, no spending, no market, no tax.
const ZERO = {
  age: 40, netWorth: 500000, gross: 0, taxRate: 0, k401: 0, match: 0, monthly: 0, credit: 750,
  inflation: 0, raiseNom: 0, promoNom: 0, promoMin: 1, promoMax: 1, promoStretch: 0, promoUntil: 99,
  pCash: 100, pBrok: 0, pRet: 0, toCash: 100, cashReal: 0, brokDrag: 0, retireTax: 0, gainsTax: 0,
  creep: 0, retireProfile: 'custom', retireSpend: 0, stopWork: 41, retireAge: 41, runTo: 90,
  ssAnnual: 0, ssAge: 67, marketProfile: 'custom', realReturn: 0, vol: 0, savedAt: '',
  promos: [], rewards: [], kids: [], buys: []
};
const HOUSE = {
  kind: 'house', label: 'House', year: Y, price: 400000, plan: 'cash', down: 400000,
  rate: 6, term: 30, growth: 0, pmi: 0, sellYear: 0
};
const UPKEEP = 0.019, COST = 0.06, EXCLUDE = 250000;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof finPath_ === 'function', null, { timeout: 15000 });

  // Net worth at a given age, with one house configured however you like.
  const at = (age, house, over) => page.evaluate(([z, h, o, a]) => {
    Object.assign(FIN, JSON.parse(JSON.stringify(z)), o || {},
      { buys: [Object.assign({}, h)] });
    return Math.round(finPath_(true).series[a - FIN.age]);
  }, [ZERO, house, over, age]);

  console.log('=== The closing statement, one deduction at a time ===');
  /* Bought outright for $400k with no growth, sold five years later. Five
     years of upkeep have been paid, then 6% of the sale price goes to
     selling it. Nothing else moves. */
  const sold = await at(46, Object.assign({}, HOUSE, { sellYear: Y + 5 }));
  const want = 500000 - 5 * 400000 * UPKEEP - 400000 * COST;
  check('price, less five years of upkeep, less 6% to sell it',
    near(sold, want, 1), `${money(sold)} vs ${money(want)}`);

  const kept = await at(46, HOUSE);
  check('and keeping it costs a sixth year of upkeep instead',
    near(kept, 500000 - 6 * 400000 * UPKEEP, 1), `${money(kept)}`);
  check('so selling is ahead by the sixth year, less the cost of selling',
    near(sold - kept, 400000 * UPKEEP - 400000 * COST, 1), `${money(sold - kept)}`);

  console.log('\n=== The upkeep stops, and stays stopped ===');
  const later = await at(60, Object.assign({}, HOUSE, { sellYear: Y + 5 }));
  check('fourteen years on, nothing more has been spent on it',
    near(later, sold, 1), `${money(later)} vs ${money(sold)}`);
  const keptLater = await at(60, HOUSE);
  check('while the house you kept has eaten fourteen more years of it',
    near(keptLater, 500000 - 20 * 400000 * UPKEEP, 1), `${money(keptLater)}`);

  console.log('\n=== Tax on the gain, above the exclusion ===');
  const grow = { growth: 5, sellYear: Y + 15, plan: 'cash', down: 400000 };
  const value = 400000 * Math.pow(1.05, 15);
  const free = await at(56, Object.assign({}, HOUSE, grow));
  const taxed = await at(56, Object.assign({}, HOUSE, grow), { gainsTax: 20 });
  const dueTax = 0.2 * Math.max(0, value - 400000 - EXCLUDE);
  check('the first $250,000 of gain is not taxed, the rest is',
    near(free - taxed, dueTax, 2), `${money(free - taxed)} vs ${money(dueTax)}`);
  // A small gain sits entirely inside the exclusion, so tax changes nothing.
  const small = { growth: 1, sellYear: Y + 5, plan: 'cash', down: 400000 };
  const smallFree = await at(46, Object.assign({}, HOUSE, small));
  const smallTaxed = await at(46, Object.assign({}, HOUSE, small), { gainsTax: 20 });
  check('a gain inside the exclusion is not taxed at all',
    smallFree === smallTaxed, `${money(smallFree)} vs ${money(smallTaxed)}`);

  console.log('\n=== A mortgage is paid off out of the proceeds ===');
  /* Comparing "sold" against "kept" is NOT the clean test it looks like: a
     mortgage payment is mostly principal, which moves cash into equity
     rather than spending it, so the difference between the two is one
     year's INTEREST plus upkeep against the cost of selling - a number with
     no closed form here.

     The invariant that is clean, and the one that actually matters: in the
     year you sell, the only thing that leaves your net worth is the cost of
     selling. The debt is cleared by money you were already counted as
     having; swapping an asset and a loan for cash of the same value must
     not move the total by anything else. */
  const M = { plan: 'c20', down: 80000, rate: 6, term: 30, growth: 0 };
  const owed = await page.evaluate(() => finRemaining_(320000, 6, 30, 10));
  check('the payoff figure matches the closed form',
    owed > 260000 && owed < 275000, money(owed));

  const sellAt = Object.assign({}, HOUSE, M, { sellYear: Y + 10 });
  const dayBefore = await at(50, sellAt), dayAfter = await at(51, sellAt);
  check('selling a mortgaged house costs exactly the 6%, and nothing else',
    near(dayBefore - dayAfter, 400000 * COST, 1),
    `${money(dayBefore - dayAfter)} vs ${money(400000 * COST)}`);

  console.log('\n=== Underwater, the same rule holds ===');
  /* 3.5% down on a house losing 12% a year: you owe far more than it is
     worth, so the sale takes money rather than giving it. The invariant is
     unchanged - what leaves is the cost of selling - but the proceeds
     themselves are negative, and that has to come out of savings rather
     than being floored at zero. */
  const drop = Object.assign({}, HOUSE,
    { plan: 'fha', down: 14000, rate: 6, term: 30, growth: -12, sellYear: Y + 3 });
  const before = await at(43, drop), after = await at(44, drop);
  const worth = 400000 * Math.pow(0.88, 3);
  check('the cost of selling is still all that leaves',
    near(before - after, worth * COST, 1),
    `${money(before - after)} vs ${money(worth * COST)}`);
  check('and the sale genuinely took money out', await page.evaluate(([z, h]) => {
    Object.assign(FIN, JSON.parse(JSON.stringify(z)), { buys: [Object.assign({}, h)] });
    // Owing more than the house is worth means a negative cheque at closing.
    const held = 3, value = 400000 * Math.pow(0.88, held);
    const left = finRemaining_(400000 - 14000, 6, 30, held);
    return value - left - value * 0.06 < 0;
  }, [ZERO, drop]));

  console.log('\n=== On the tab ===');
  await page.evaluate(([h, y]) => {
    Object.assign(FIN, JSON.parse(JSON.stringify(FIN_DEFAULTS)),
      { buys: [Object.assign({}, h, { year: y + 2, sellYear: y + 20, plan: 'c20', down: 84000 })] });
    showAppView('financial'); renderFinancialTab();
  }, [HOUSE, Y]);
  await page.waitForFunction(() => /median/.test(
    document.getElementById('finReadout').textContent || ''), null, { timeout: 15000 });
  await page.waitForTimeout(500);

  const shading = await page.evaluate(() => {
    const svg = document.getElementById('finCone');
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    const x0 = 46, x1 = vb[2] - 8;
    const X = age => x0 + (x1 - x0) * ((age - FIN.age) / (FIN.runTo - FIN.age));
    const w = [...svg.querySelectorAll('rect:not(.chart-hit)')]
      .filter(r => +r.getAttribute('height') > vb[3] * 0.4)[0];
    const sold = FIN.age + (FIN.buys[0].sellYear - FIN_YEAR0);
    return { end: +w.getAttribute('x') + +w.getAttribute('width'), wantEnd: X(sold),
             full: X(FIN.age + (FIN.buys[0].year - FIN_YEAR0) + 30) };
  });
  check('the shading stops at the sale, not at the end of the mortgage',
    Math.abs(shading.end - shading.wantEnd) < 1.5 && shading.wantEnd < shading.full - 10,
    `ends ${shading.end.toFixed(1)}, sale at ${shading.wantEnd.toFixed(1)}, term would run to ${shading.full.toFixed(1)}`);

  await page.evaluate(() => openFinancialEdit());
  await page.waitForTimeout(400);
  const row = await page.evaluate(() => {
    const r = document.querySelector('.fin-row[data-fin-kind="buy"]');
    return { field: !!r.querySelector('[data-f="sellYear"]'),
             note: r.querySelector('.fin-note').textContent };
  });
  check('a property row offers a year to sell in', row.field);
  check('the note says what actually reaches you',
    /reaches you/.test(row.note) && /selling costs/.test(row.note), row.note.slice(0, 100));
  check('and warns that nothing replaces the housing cost',
    /rent/.test(row.note), row.note.slice(-80));

  // Blank means keep it - the common case must not need a magic number.
  await page.evaluate(() => { FIN.buys[0].sellYear = 0; finBuildRows_(); renderFinancialTab(); });
  await page.waitForTimeout(500);
  const blank = await page.evaluate(() =>
    document.querySelector('.fin-row[data-fin-kind="buy"] .fin-note').textContent);
  check('leaving it blank keeps the house, and says so',
    /leave blank to keep it/.test(blank), blank.slice(-60));

  await ctx.close();
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
