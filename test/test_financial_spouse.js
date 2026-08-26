/* A second income.

   The tempting shortcut is to add the two salaries together and run the
   household through one calculation. That is wrong in two ways at once, and
   both are checked here:

     - Payroll tax is PER PERSON. Social Security stops at the wage base for
       each earner separately, so two people on $150,000 pay MORE of it than
       one person on $300,000 - $22,950 against $16,689 - because the single
       earner's is capped and neither of the pair reaches the cap. A
       household total would have quietly given the couple the single
       earner's cap and under-taxed them by $6,261 a year.
     - The 401k limit is per person too, so one partner's unused room must
       not subsidise the other's.

   And the reason their income needs its own end age: two people rarely
   finish on the same day, so a spouse still working after you stop is
   income during years the model would otherwise treat as pure drawdown. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };
const money = n => '$' + Math.round(n).toLocaleString();
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Worked out here from the published 2026 figures, not read off the app.
const FICA = s => Math.min(s, 184500) * 0.062 + s * 0.0145 + Math.max(0, s - 200000) * 0.009;

const ZERO = {
  age: 30, netWorth: 0, gross: 0, taxRate: 0, k401: 0, match: 0, monthly: 0, credit: 750,
  inflation: 0, raiseNom: 0, promoNom: 0, promoMin: 1, promoMax: 1, promoStretch: 0, promoUntil: 99,
  pCash: 100, pBrok: 0, pRet: 0, toCash: 100, cashReal: 0, brokDrag: 0, retireTax: 0, gainsTax: 0,
  creep: 0, retireProfile: 'custom', retireSpend: 0, stopWork: 40, retireAge: 40, runTo: 50,
  ssAnnual: 0, ssAge: 67, marketProfile: 'custom', realReturn: 0, vol: 0, savedAt: '',
  spouseGross: 0, spouse401k: 0, spouseMatch: 0, spouseStop: 40,
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
  await page.waitForFunction(() => typeof finPath_ === 'function', null, { timeout: 15000 });

  const at = (age, over) => page.evaluate(([z, o, a]) => {
    Object.assign(FIN, JSON.parse(JSON.stringify(z)), o);
    return Math.round(finPath_(true).series[a - FIN.age]);
  }, [ZERO, over, age]);

  console.log('=== Off by default ===');
  check('a plan with no second income banks only yours',
    near(await at(40, { gross: 100000 }), (100000 - FICA(100000)) * 10, 1),
    money(await at(40, { gross: 100000 })));

  console.log('\n=== Both incomes are banked ===');
  const pair = await at(40, { gross: 100000, spouseGross: 60000 });
  const want = ((100000 - FICA(100000)) + (60000 - FICA(60000))) * 10;
  check('ten years of two salaries, each taxed on its own',
    near(pair, want, 1), `${money(pair)} vs ${money(want)}`);

  console.log('\n=== Payroll tax is per person, and that CUTS both ways ===');
  /* One earner on $300,000 pays Social Security on the first $184,500 only.
     Two on $150,000 each pay it on all of theirs - so the couple keeps
     LESS, not more. A household-total calculation would have given them the
     single earner's cap and been $6,261 a year too generous. */
  const solo = await at(40, { gross: 300000 });
  const split = await at(40, { gross: 150000, spouseGross: 150000 });
  check('one big salary is taxed against one wage base',
    near(solo, (300000 - FICA(300000)) * 10, 1), money(solo));
  check('two smaller ones are taxed against two',
    near(split, 2 * (150000 - FICA(150000)) * 10, 1), money(split));
  check('so the couple keeps less, by the extra Social Security they owe',
    near(solo - split, (2 * FICA(150000) - FICA(300000)) * 10, 1),
    `${money(solo - split)} vs ${money((2 * FICA(150000) - FICA(300000)) * 10)}`);

  console.log('\n=== The 401k limit is theirs alone ===');
  /* 40% of $200,000 is $80,000; only $24,500 may be deferred. If the limit
     were pooled, one partner's unused room would let the other over-defer
     and dodge income tax on the excess. */
  const capped = await at(40, { gross: 0, spouseGross: 200000, spouse401k: 40, taxRate: 25 });
  const home = (200000 - 24500) * 0.75 - FICA(200000);
  check('their deferral stops at the elective limit',
    near(capped, (24500 + home) * 10, 2), `${money(capped)} vs ${money((24500 + home) * 10)}`);
  check('and it is genuinely less than deferring the whole 40%',
    capped < (80000 + (120000 * 0.75 - FICA(200000))) * 10 - 1000);

  console.log('\n=== Their income stops on its own age ===');
  const early = await at(40, { gross: 100000, spouseGross: 60000, spouseStop: 35 });
  const late = await at(40, { gross: 100000, spouseGross: 60000, spouseStop: 40 });
  check('five fewer working years is five fewer salaries',
    near(late - early, 5 * (60000 - FICA(60000)), 1),
    `${money(late - early)} vs ${money(5 * (60000 - FICA(60000)))}`);
  check('and stopping today contributes nothing',
    near(await at(40, { gross: 100000, spouseGross: 60000, spouseStop: 30 }),
      (100000 - FICA(100000)) * 10, 1));

  console.log('\n=== They can still be working after you stop ===');
  /* The case the single stopWork age could not express, and the reason this
     is not just another number added to your salary: years that used to be
     pure drawdown now have income in them. */
  const overlap = await at(45, { gross: 100000, stopWork: 35, retireAge: 45, runTo: 45,
    spouseGross: 60000, spouseStop: 45 });
  const hand = 5 * (100000 - FICA(100000)) + 15 * (60000 - FICA(60000));
  check('your five years plus their fifteen', near(overlap, hand, 1),
    `${money(overlap)} vs ${money(hand)}`);

  console.log('\n=== The retirement budget follows household pay ===');
  /* A replacement rate is a share of what the household was LIVING on.
     Leaving the second income out would size retirement for one person and
     then spend for two. */
  const budgets = await page.evaluate(([z]) => {
    const of = o => { Object.assign(FIN, JSON.parse(JSON.stringify(z)), o); return finFinalSalary_(); };
    return { alone: of({ gross: 100000, retireProfile: 'standard' }),
             pair: of({ gross: 100000, spouseGross: 60000, spouseStop: 40, retireProfile: 'standard' }) };
  }, [ZERO]);
  check('household final pay includes both', near(budgets.pair - budgets.alone, 60000, 1),
    `${money(budgets.alone)} alone vs ${money(budgets.pair)} together`);

  // And so the minimum needed rises with it, rather than staying single-sized.
  const needs = await page.evaluate(([z]) => {
    const of = o => { Object.assign(FIN, JSON.parse(JSON.stringify(z)), o);
      return finMinimumNeeded_(FIN_NEED_TARGET); };
    return { alone: of({ gross: 100000, retireProfile: 'standard', runTo: 70 }),
             pair: of({ gross: 100000, spouseGross: 60000, spouseStop: 40,
                        retireProfile: 'standard', runTo: 70 }) };
  }, [ZERO]);
  check('so the pot a couple needs is bigger than one person\'s',
    needs.pair > needs.alone * 1.4,
    `${money(needs.alone)} vs ${money(needs.pair)}`);

  console.log('\n=== On the panel ===');
  await page.evaluate(() => {
    Object.assign(FIN, JSON.parse(JSON.stringify(FIN_DEFAULTS)));
    showAppView('financial'); renderFinancialTab(); openFinancialEdit();
  });
  await page.waitForTimeout(600);
  const off = await page.evaluate(() => ({
    fields: ['spouseGross', 'spouse401k', 'spouseMatch', 'spouseStop']
      .every(k => !!document.getElementById('fin_' + k)),
    note: document.getElementById('finEditBody').textContent
  }));
  check('the fields are there', off.fields);
  check('and say what to do if there is no second income',
    /just you/i.test(off.note), '…' + off.note.match(/.{0,40}just you.{0,10}/i));

  await page.fill('#fin_spouseGross', '70000');
  await page.waitForTimeout(700);
  const on = await page.evaluate(() =>
    document.getElementById('finEditBody').textContent);
  check('turning it on quotes their take-home',
    /take-home a year on top of yours/.test(on), '…' + (on.match(/.{0,60}on top of yours/) || [''])[0]);
  check('and says the tax is counted per person',
    /per person, not\s+per household/.test(on));

  /* Every group summary quotes a live figure, and they used to be built once
     with the panel - so they went stale the moment you typed and sat there
     disagreeing with the chart above them. Each one has to move on its own
     input, and none may rebuild the panel to do it: that would take focus
     out of the field you are still typing in. */
  console.log('\n=== No summary line goes stale while you type ===');
  const stale = async (field, value, pattern) => {
    await page.fill('#fin_' + field, String(value));
    await page.waitForTimeout(600);
    return page.evaluate(p => {
      const el = document.querySelector(`[data-fin-derived="${p}"]`);
      return { text: el ? el.textContent : '', focus: document.activeElement.id };
    }, pattern);
  };
  const gross = await stale('gross', 250000, 'you');
  check('your take-home follows your pay', /\$1[6-9][\d,]*|\$2[\d,]*/.test(gross.text),
    gross.text.slice(0, 80));
  check('and the field keeps focus', gross.focus === 'fin_gross', gross.focus);

  const worth = await stale('netWorth', 800000, 'buckets');
  check('the buckets follow net worth', /\$/.test(worth.text) && !/\$48,000/.test(worth.text),
    worth.text.slice(0, 70));

  const raise = await stale('raiseNom', 9, 'growth');
  check('the salary you finish on follows the raise', /salary reaches/.test(raise.text),
    raise.text.slice(0, 70));

  const stop = await stale('spouseStop', 55, 'spouse');
  check('and their end age follows the field', /you are 55/.test(stop.text),
    stop.text.slice(0, 70));

  await ctx.close();
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
