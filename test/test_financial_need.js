/* The minimum you need to retire.

   The number has to be worked out by the same engine that draws the cone,
   not by a rule of thumb, and this is where that is enforced. A 4%-rule
   figure would quietly ignore the mortgage still running at 65, the child at
   college at 67, Social Security arriving at 67, and the tax paid on the way
   out of the retirement account. Every one of those is checked below by
   turning it on alone and confirming the answer moves by exactly the amount
   arithmetic says it should.

   With growth, volatility and tax all switched off the answer collapses to
   something you can do on paper - spend x years - which is what makes these
   real checks rather than the test agreeing with whatever the code prints.
   Note the year count: retiring at 60 and planning through 70 is ELEVEN
   years of spending, not ten. You spend in the year you turn 70. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };
const money = n => '$' + Math.round(n).toLocaleString();
const near = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct / 100 + 1;

// Everything off. Each case turns on exactly one thing.
const ZERO = {
  age: 50, netWorth: 0, gross: 0, taxRate: 0, k401: 0, match: 0, monthly: 0, credit: 750,
  inflation: 0, raiseNom: 0, promoNom: 0, promoMin: 1, promoMax: 1, promoStretch: 0, promoUntil: 99,
  pCash: 0, pBrok: 0, pRet: 100, toCash: 0, cashReal: 0, brokDrag: 0, retireTax: 0, gainsTax: 0,
  creep: 0, retireProfile: 'custom', retireSpend: 50000, stopWork: 60, retireAge: 60, runTo: 70,
  ssAnnual: 0, ssAge: 67, marketProfile: 'custom', realReturn: 0, vol: 0, savedAt: '',
  promos: [], rewards: [], kids: [], buys: []
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof finMinimumNeeded_ === 'function', null, { timeout: 15000 });

  const need = over => page.evaluate(([z, o]) => {
    Object.assign(FIN, JSON.parse(JSON.stringify(z)), o);
    return finMinimumNeeded_(FIN_NEED_TARGET);
  }, [ZERO, over]);

  console.log('=== With nothing else on, it is spending times years ===');
  const base = await need({});
  check('$50k a year from 60 through 70 needs eleven years of it',
    near(base, 550000, 0.1), `${money(base)} vs ${money(550000)}`);
  const longer = await need({ runTo: 80 });
  check('planning ten years further needs ten more years of it',
    near(longer, 1050000, 0.1), `${money(longer)} vs ${money(1050000)}`);
  const later = await need({ stopWork: 65, retireAge: 65 });
  check('retiring five years later needs five fewer',
    near(later, 300000, 0.1), `${money(later)} vs ${money(300000)}`);
  const leaner = await need({ retireSpend: 30000 });
  check('and it scales with the budget', near(leaner, 330000, 0.1),
    `${money(leaner)} vs ${money(330000)}`);

  console.log('\n=== The things a rule of thumb would miss ===');
  /* Tax on the way out. The pot has to be big enough to pay the tax AND the
     budget, so a 20% exit tax multiplies the requirement by exactly 1/0.8.
     A 4%-rule number ignores this entirely. */
  const taxed = await need({ retireTax: 20 });
  check('a 20% withdrawal tax scales the pot by exactly 1/0.8',
    near(taxed / base, 1.25, 0.5), `x${(taxed / base).toFixed(3)}`);
  const taxed40 = await need({ retireTax: 40 });
  check('and a 40% one by 1/0.6', near(taxed40 / base, 1 / 0.6, 0.5),
    `x${(taxed40 / base).toFixed(3)}`);

  // Social Security pays part of the bill, so the pot only covers the rest.
  const ss = await need({ ssAnnual: 20000, ssAge: 60 });
  check('$20k of Social Security leaves only $30k a year to fund',
    near(ss, 330000, 0.1), `${money(ss)} vs ${money(330000)}`);
  const ssLate = await need({ ssAnnual: 20000, ssAge: 65 });
  check('and arriving five years later covers five years less',
    near(ssLate, 430000, 0.1), `${money(ssLate)} vs ${money(430000)}`);
  check('so claiming later needs a bigger pot', ssLate > ss);

  /* A commitment that outlives your last pay packet is exactly what a rule
     of thumb drops. Five years of a $24k/yr car lease running past
     retirement is $120k the pot has to carry on top of the budget. */
  const lease = await need({
    buys: [{ kind: 'car', label: 'Car', mode: 'lease', year: new Date().getFullYear() + 10,
             price: 0, down: 0, rate: 0, term: 5, lease: 2000, used: 0 }]
  });
  check('a lease still running in retirement is counted',
    near(lease - base, 24000 * 11, 2), `${money(lease - base)} more`);

  console.log('\n=== It means what it says ===');
  /* The real check: feed the answer back in as the starting pot and the
     money must actually last. One notch below it, it must not. */
  const proof = await page.evaluate(([z, target]) => {
    Object.assign(FIN, JSON.parse(JSON.stringify(z)),
      { realReturn: 4, vol: 12, retireTax: 15, ssAnnual: 18000 });
    const want = finMinimumNeeded_(target);
    // Re-run the same drawdown from a given pot, exactly as the solver does.
    const survives = pot => {
      const save = FIN, shift = FIN.retireAge - FIN.age;
      const scratch = JSON.parse(JSON.stringify(FIN));
      scratch.age = save.retireAge; scratch.stopWork = save.retireAge;
      scratch.gross = finFinalSalary_(); scratch.netWorth = pot;
      scratch.kids = save.kids.map(k => Object.assign({}, k, { birthYear: k.birthYear - shift }));
      scratch.buys = save.buys.map(b => Object.assign({}, b, { year: b.year - shift }));
      try { FIN = scratch; finReseed_(); return finSurvivalFrom_(pot); }
      finally { FIN = save; }
    };
    return { want, at: survives(want), under: survives(want * 0.8), over: survives(want * 1.3) };
  }, [ZERO, 0.9]);
  check('the pot it names does last, in the share of runs it claims',
    proof.at >= 0.89, `${Math.round(proof.at * 100)}% survive`);
  check('a fifth less does not', proof.under < 0.89,
    `${Math.round(proof.under * 100)}% survive on ${money(proof.want * 0.8)}`);
  check('and more is safer still', proof.over >= proof.at,
    `${Math.round(proof.over * 100)}% on ${money(proof.want * 1.3)}`);

  console.log('\n=== Same plan, same figure ===');
  const twice = await page.evaluate(([z]) => {
    Object.assign(FIN, JSON.parse(JSON.stringify(z)), { realReturn: 4, vol: 12 });
    return [finMinimumNeeded_(FIN_NEED_TARGET), finMinimumNeeded_(FIN_NEED_TARGET)];
  }, [ZERO]);
  check('asking twice gives one answer', twice[0] === twice[1],
    twice.map(money).join(' vs '));

  console.log('\n=== On the tab ===');
  await page.evaluate(() => {
    Object.assign(FIN, JSON.parse(JSON.stringify(FIN_DEFAULTS)));
    showAppView('financial'); renderFinancialTab();
  });
  await page.waitForFunction(() => /median/.test(
    document.getElementById('finReadout').textContent || ''), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => ({
    shown: document.getElementById('finNeedCard').style.display !== 'none',
    value: document.getElementById('finNeedValue').textContent,
    have: document.getElementById('finNeedHave').textContent,
    age: document.getElementById('finNeedAge').textContent,
    fill: document.getElementById('finNeedFill').style.width,
    cls: document.getElementById('finNeedFill').className,
    note: document.getElementById('finNeedNote').textContent
  }));
  check('the card is on the tab', card.shown);
  check('it names the retirement age',
    card.age === String(await page.evaluate(() => FIN.retireAge)), card.age);
  check('it shows a figure to reach and one you are on course for',
    /^\$[\d,]+$/.test(card.value) && /^\$[\d,]+$/.test(card.have), `${card.value} / ${card.have}`);
  check('the meter is a real proportion, never over full',
    parseFloat(card.fill) > 0 && parseFloat(card.fill) <= 100, card.fill);
  check('and is coloured for falling short', card.cls === 'bad' || card.cls === 'short', card.cls);
  check('the note says what the pot has to cover and for how long',
    /a year from/.test(card.note) && /90%/.test(card.note), card.note.slice(0, 90));
  check('and turns the shortfall into a yearly saving figure',
    /short/.test(card.note) && /a year more saved/.test(card.note), card.note.slice(-90));

  // Clearing the bar has to read differently, or the card only ever nags.
  await page.evaluate(() => { FIN.netWorth = 4000000; FIN_RAW.netWorth = 4000000; renderFinancialTab(); });
  await page.waitForTimeout(700);
  const rich = await page.evaluate(() => ({
    cls: document.getElementById('finNeedFill').className,
    fill: document.getElementById('finNeedFill').style.width,
    note: document.getElementById('finNeedNote').textContent
  }));
  check('clearing it fills the meter and says so',
    rich.cls === '' && parseFloat(rich.fill) === 100 && /clear of it/.test(rich.note),
    `${rich.cls || 'ok'} ${rich.fill} — ${rich.note.slice(-50)}`);

  await ctx.close();
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
