/* The same plan gives the same answer.

   This ran on Math.random(), so every recompute drew 2000 fresh lives.
   Re-entering a figure you had already entered moved the headline by up to
   $105,000 and the survival rate by three points - so you could reroll until
   you liked the number, and no two versions of a plan could be compared.

   Two things are pinned here, and the second is the one that is easy to
   lose later:

   1. Determinism. Same inputs, same output - across recomputes, across
      re-entering a value, and across a reload. A per-session seed would
      pass the first two and fail the third.

   2. That the seed is a CONSTANT rather than a hash of the inputs. Both
      make re-entry stable, but only a constant seed replays the identical
      draws for every scenario, so nudging one figure moves the cone by the
      amount that figure is worth. Hash the inputs instead and every
      keystroke reshuffles all 2000 lives: $1,000 of net worth would move
      the projection by tens of thousands in either direction, which is the
      original bug wearing a different hat. The monotonic-nudge check below
      is what tells those two apart. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };
const money = n => '$' + Math.round(n).toLocaleString();

const openFin = async page => {
  await page.waitForFunction(() => typeof finSimulate_ === 'function'
    && typeof showAppView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => showAppView('financial'));
  await page.waitForFunction(() => /median/.test(
    document.getElementById('finReadout').textContent || ''), null, { timeout: 15000 });
};

// The whole answer, not just the median - a seed leak could pin one
// percentile and still let the others drift.
const answer = page => page.evaluate(() => {
  const res = finSimulate_();
  const d = res.band.find(x => x.age === FIN.retireAge);
  return { p10: Math.round(d.p10), p50: Math.round(d.p50), p90: Math.round(d.p90),
           success: res.success, broke: res.medianBroke,
           tail: Math.round(res.band[res.band.length - 1].p50) };
});
const hero = page => page.evaluate(() =>
  document.getElementById('finHero').textContent.trim());

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForTimeout(900);
  await openFin(page);

  console.log('=== Recomputing an unchanged plan changes nothing ===');
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push(await answer(page));
  const first = JSON.stringify(runs[0]);
  check('ten recomputes agree exactly', runs.every(r => JSON.stringify(r) === first),
    `${new Set(runs.map(r => r.p50)).size} distinct medians`);
  check('and so does every percentile, not just the median',
    new Set(runs.map(r => r.p10)).size === 1 && new Set(runs.map(r => r.p90)).size === 1);
  check('and the survival rate', new Set(runs.map(r => r.success)).size === 1,
    [...new Set(runs.map(r => Math.round(r.success * 1000) / 10))].join(', ') + '%');
  check('and the far end of the plan, not only the retirement year',
    new Set(runs.map(r => r.tail)).size === 1);

  console.log('\n=== Re-entering the same figure gives the same projection ===');
  await page.evaluate(() => openFinancialEdit());
  await page.waitForTimeout(400);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    // Clear it and type it back, exactly as you would by hand.
    await page.fill('#fin_netWorth', '');
    await page.waitForTimeout(120);
    await page.fill('#fin_netWorth', '125000');
    await page.waitForTimeout(700);
    seen.push(await hero(page));
  }
  check('typing 125000 four times gives one answer', new Set(seen).size === 1,
    [...new Set(seen)].join(' | '));

  console.log('\n=== It is the seed, not a cache ===');
  /* A cached result would also pass the checks above and be badly wrong: it
     would keep answering with the OLD number after a real change. */
  const before = await answer(page);
  await page.fill('#fin_netWorth', '900000');
  await page.waitForTimeout(700);
  const after = await answer(page);
  check('a real change still moves the projection', after.p50 > before.p50 + 100000,
    `${money(before.p50)} -> ${money(after.p50)}`);
  await page.fill('#fin_netWorth', '125000');
  await page.waitForTimeout(700);
  check('and going back gives the first answer again',
    (await answer(page)).p50 === before.p50,
    `${money(before.p50)} vs ${money((await answer(page)).p50)}`);

  console.log('\n=== A reload does not reroll it ===');
  const kept = await answer(page);
  await page.reload();
  await page.waitForTimeout(900);
  await openFin(page);
  check('the plan reads the same in a fresh session',
    JSON.stringify(await answer(page)) === JSON.stringify(kept),
    `${money(kept.p50)} vs ${money((await answer(page)).p50)}`);

  console.log('\n=== Small changes move it by a small amount ===');
  /* The point of a fixed seed over an input-derived one. Every scenario
     replays the same draws, so $1,000 more in the bank is worth what
     $1,000 is worth - not a fresh roll of 2000 lives. */
  // The reload above closed the sheet; the fields only exist while it is open.
  await page.evaluate(() => openFinancialEdit());
  await page.waitForTimeout(400);
  const walk = [];
  for (const nw of [100000, 101000, 102000, 103000, 104000, 105000]) {
    await page.fill('#fin_netWorth', String(nw));
    await page.waitForTimeout(650);
    walk.push({ nw, p50: (await answer(page)).p50 });
  }
  const steps = walk.slice(1).map((w, i) => w.p50 - walk[i].p50);
  check('more money never projects to less', steps.every(d => d > 0),
    steps.map(money).join(', '));
  // Every $1,000 step should be worth roughly the same - a reshuffle would
  // show wildly uneven jumps, some of them tens of thousands.
  const lo = Math.min(...steps), hi = Math.max(...steps);
  check('and each equal step is worth about the same',
    hi < lo * 2.5 && hi < 20000, `steps ranged ${money(lo)} to ${money(hi)}`);

  console.log('\n=== The volatility band is still real ===');
  // Determinism must not have flattened the model into a single line.
  const spread = await answer(page);
  check('the cone still has a width', spread.p90 > spread.p50 && spread.p50 > spread.p10,
    `${money(spread.p10)} / ${money(spread.p50)} / ${money(spread.p90)}`);
  /* The cone has TWO sources of spread, not one: the market, and when your
     promotions land - each life draws its own cadence between the "every
     1 year" and "every 1.5 years" bounds. So zeroing volatility alone does
     not flatten it, and should not: a career is genuinely uncertain even if
     markets were not. It collapses only when both are pinned. */
  const marketOnly = await page.evaluate(() => {
    FIN.vol = 0; FIN.marketProfile = 'custom';
    const res = finSimulate_();
    const d = res.band.find(x => x.age === FIN.retireAge);
    return Math.round(d.p90) - Math.round(d.p10);
  });
  check('zero volatility still leaves the spread from promotion timing',
    marketOnly > 0, `${money(marketOnly)} wide`);
  const flat = await page.evaluate(() => {
    FIN.promoMax = FIN.promoMin;          // promotions land on a fixed cadence
    const res = finSimulate_();
    const d = res.band.find(x => x.age === FIN.retireAge);
    return Math.round(d.p90) - Math.round(d.p10);
  });
  check('and with both pinned it collapses to a single line', flat === 0, `${money(flat)} wide`);

  await ctx.close();
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
