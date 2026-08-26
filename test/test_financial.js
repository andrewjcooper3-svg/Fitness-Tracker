/* The Financial Future tab. The engine is the one audited in the prototype,
   so what is checked here is that the port kept its arithmetic and that the
   tab behaves like the rest of the app.

   The trap this guards hardest: the three ages clamp against each other, and
   a half-typed number must never be written permanently over its neighbour.
   That bug shipped once already. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };
const near = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct / 100 + 1;

const open = async page => {
  await page.evaluate(() => showAppView('financial'));
  await page.waitForFunction(() => {
    const t = document.getElementById('finReadout');
    return t && /median/.test(t.textContent);
  }, null, { timeout: 15000 });
  // The carousel slides over 0.34s, so anything measuring position has to
  // wait for the transform to settle rather than catching it in flight. The
  // resting x is not zero on desktop, where the sidebar offsets the content,
  // so settle on "stopped moving" rather than on a particular number.
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const x = await page.evaluate(() =>
      Math.round(document.getElementById('view-financial').getBoundingClientRect().left));
    if (prev !== null && x === prev) break;
    prev = x;
    await page.waitForTimeout(60);
  }
};
// The readout speaks for the RETIREMENT age, so anything that has to be read
// at another age asks the band directly. Deterministic while vol is 0.
const med = page => page.evaluate(() => {
  const m = document.getElementById('finReadout').textContent.match(/median \$([\d,]+)/);
  return m ? +m[1].replace(/,/g, '') : null;
});
const bandAt = (page, age) => page.evaluate(a => {
  const d = finSimulate_().band.find(x => x.age === a);
  return d ? Math.round(d.p50) : null;
}, age);

// Everything off; each case turns on only what it is testing.
const ZERO = {
  age: 30, netWorth: 0, gross: 0, taxRate: 0, k401: 0, match: 0, monthly: 0, credit: 750,
  inflation: 0, raiseNom: 0, promoNom: 0, promoMin: 1, promoMax: 1, promoStretch: 0, promoUntil: 99,
  pCash: 0, pBrok: 0, pRet: 100, toCash: 0, cashReal: 0, brokDrag: 0, retireTax: 0, gainsTax: 0,
  creep: 0,
  retireProfile: 'custom', retireSpend: 0, stopWork: 40, retireAge: 40, runTo: 50,
  ssAnnual: 0, ssAge: 67, marketProfile: 'custom', realReturn: 0, vol: 0,
  promos: [], rewards: [], kids: [], buys: []
};

/* Payroll tax, worked out here from the published 2026 figures rather than
   read back off the app - the point is to check the model against a second
   derivation, not against itself. Social Security 6.2% to the $184,500 wage
   base, Medicare 1.45% on everything, 0.9% more above $200,000. It is
   charged on the WHOLE salary: deferring to a 401k does not avoid it. */
const FICA = s => Math.min(s, 184500) * 0.062 + s * 0.0145 + Math.max(0, s - 200000) * 0.009;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [w, h, tag] of [[430, 932, 'phone'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} (${w}x${h}) ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.goto(URL);
    await page.waitForTimeout(900);

    check('the tab is in the bar', await page.evaluate(() =>
      [...document.querySelectorAll('.app-tab-label')].some(t => t.textContent.trim() === 'Future')));
    /* Every view needs a CSS `order` matching its index in viewOrder. Miss it
       and the view defaults to 0, stacks on Overview, and the carousel shows
       the wrong content while the right tab highlights - which looks like the
       tab is broken rather than like a stylesheet gap. */
    check('every view has a distinct carousel order', await page.evaluate(() => {
      const seen = {};
      let bad = '';
      ['overview','tracker','kitchen','music','calendar','stats','financial'].forEach(v => {
        const el = document.getElementById('view-' + v);
        const o = el ? getComputedStyle(el).order : 'missing';
        if (seen[o]) bad = `${v} and ${seen[o]} share order ${o}`;
        seen[o] = v;
      });
      return bad || true;
    }) === true, await page.evaluate(() => ['overview','tracker','kitchen','music','calendar','stats','financial']
      .map(v => v + '=' + getComputedStyle(document.getElementById('view-' + v)).order).join(' ')));
    /* Where a view rests is not x=0 - the desktop sidebar offsets it - so
       the check is that Future lands exactly where History lands, and that
       Overview is nowhere near. That catches the order collision without
       hard-coding a layout constant. */
    await page.evaluate(() => showAppView('stats'));
    await page.waitForTimeout(700);
    const restX = await page.evaluate(() =>
      Math.round(document.getElementById('view-stats').getBoundingClientRect().left));
    await open(page);
    const pos = await page.evaluate(() => ({
      fin: Math.round(document.getElementById('view-financial').getBoundingClientRect().left),
      ov: Math.round(document.getElementById('view-overview').getBoundingClientRect().left)
    }));
    check('the Future tab actually shows the Future view', pos.fin === restX,
      `financial at ${pos.fin}, a resting view sits at ${restX}`);
    check('and Overview is not stacked underneath it', Math.abs(pos.ov - pos.fin) > 100,
      `overview at ${pos.ov}`);
    check('it renders a verdict', await page.evaluate(() =>
      document.getElementById('finVerdict').textContent.trim().length > 10));
    check('and a hero figure', await page.evaluate(() =>
      /\$/.test(document.getElementById('finHero').textContent)));

    const cone = await page.evaluate(() => {
      const s = document.getElementById('finCone');
      const m = s.getScreenCTM();
      return { ratio: Math.round(m.a / m.d * 1000) / 1000, kids: s.children.length,
               par: s.getAttribute('preserveAspectRatio'),
               band: s.querySelectorAll('polygon').length };
    });
    check('the cone is drawn 1:1, not stretched', Math.abs(cone.ratio - 1) < 0.02, `${cone.ratio}x`);
    check('and not left on preserveAspectRatio="none"', cone.par !== 'none', String(cone.par));
    check('the percentile band is a real shape', cone.band === 1, String(cone.band));
    check('rows land in the table', await page.evaluate(() =>
      document.querySelectorAll('#finTable tbody tr').length >= 3));
    check('no sideways scroll', !(await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)));
    await ctx.close();
  }

  console.log('\n=== The arithmetic survived the port ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    const run = async over => {
      await page.addInitScript(st => localStorage.setItem('FINANCIAL_FUTURE_STATE', JSON.stringify(st)),
        Object.assign({}, ZERO, over));
      await page.goto(URL);
      await page.waitForTimeout(900);
      await open(page);
      return med(page);
    };
    // Same setup, but read at an age of your choosing rather than at retirement.
    const runAt = async (over, age) => { await run(over); return bandAt(page, age); };
    /* Payroll tax is unavoidable, so even a zeroed scenario pays it. It used
       to be missing entirely, which handed back 7.65% of every salary as
       savings - $7,268 a year at $95k, compounding for thirty years. */
    const plain = await run({ gross: 100000 });
    check('10 working years x $100k, less payroll tax',
      plain === Math.round((100000 - FICA(100000)) * 10),
      `$${plain.toLocaleString()} vs $${Math.round((100000 - FICA(100000)) * 10).toLocaleString()}`);
    check('and that is $76,500 less than the gross figure',
      Math.round(1000000 - plain) === Math.round(FICA(100000) * 10),
      `$${Math.round(1000000 - plain).toLocaleString()}`);
    // Above the wage base only Medicare keeps going, so the marginal rate falls.
    const big = await run({ gross: 300000 });
    check('the Social Security wage base caps that half of it',
      near(big, (300000 - FICA(300000)) * 10, 0.02),
      `$${big.toLocaleString()} vs $${Math.round((300000 - FICA(300000)) * 10).toLocaleString()}`);

    const comp = await run({ netWorth: 100000, realReturn: 5 });
    check('$100k at 5% real for 10 years', near(comp, 100000 * Math.pow(1.05, 10), 0.02),
      `$${comp.toLocaleString()} vs $${Math.round(100000 * Math.pow(1.05, 10)).toLocaleString()}`);
    const k = await run({ gross: 100000, taxRate: 25, k401: 10, match: 5 });
    const kWant = (10000 + 5000 + (90000 * 0.75 - FICA(100000))) * 10;
    check('401k is pre-tax, the match is added, payroll tax is not dodged',
      near(k, kWant, 0.02), `$${k.toLocaleString()} vs $${Math.round(kWant).toLocaleString()}`);

    /* The IRS caps what may go in. An uncapped percentage quietly banks more
       than the law allows the moment pay is large enough, and the excess
       compounds for the rest of the plan. 2026: $24,500 elective, $72,000
       employee-and-employer combined. */
    // 20% of $400k is $80,000; only $24,500 of it may be deferred, and the
    // rest has to be taken as pay and taxed. Worked through by hand:
    const home400 = k => (400000 - k) * 0.75 - FICA(400000);
    const capped = await run({ gross: 400000, k401: 20, match: 0, taxRate: 25 });
    check('the 401k stops at the elective limit',
      near(capped, (24500 + home400(24500)) * 10, 0.02),
      `$${capped.toLocaleString()} vs $${Math.round((24500 + home400(24500)) * 10).toLocaleString()}`);
    check('which is genuinely less than deferring the whole 20%',
      capped < (80000 + home400(80000)) * 10 - 1000,
      `uncapped would be $${Math.round((80000 + home400(80000)) * 10).toLocaleString()}`);
    // The employer's 20% would be another $80,000; the combined limit leaves
    // room for $47,500 of it.
    const both = await run({ gross: 400000, k401: 20, match: 20, taxRate: 25 });
    check('and employee plus employer stops at the combined limit',
      near(both, (24500 + 47500 + home400(24500)) * 10, 0.02),
      `$${both.toLocaleString()} vs $${Math.round((24500 + 47500 + home400(24500)) * 10).toLocaleString()}`);
    const raise = await run({ gross: 100000, raiseNom: 3, inflation: 3 });
    check('a raise equal to inflation is no raise',
      raise === Math.round((100000 - FICA(100000)) * 10), `$${raise.toLocaleString()}`);
    // The median must sit BELOW naive compounding - that is volatility drag,
    // and it is the whole reason for showing a band rather than a line.
    const vol = await run({ netWorth: 100000, realReturn: 5, vol: 20 });
    const mu = Math.log(1.05) - 0.02;
    check('the lognormal median follows exp(mu*n)', near(vol, 100000 * Math.exp(mu * 10), 6),
      `$${vol.toLocaleString()} vs $${Math.round(100000 * Math.exp(mu * 10)).toLocaleString()}`);
    check('and is below the naive compound figure', vol < 100000 * Math.pow(1.05, 10));

    console.log('\n--- Raises are not banked whole ---');
    /* A budget frozen in real terms while real pay grows means every raise
       is saved in full, forever. Nobody lives that way, and it was the
       single biggest reason this model outran what a planner would say. */
    const noCreep = await run({ gross: 100000, raiseNom: 5, inflation: 0, monthly: 4000, creep: 0 });
    const halfCreep = await run({ gross: 100000, raiseNom: 5, inflation: 0, monthly: 4000, creep: 50 });
    const allCreep = await run({ gross: 100000, raiseNom: 5, inflation: 0, monthly: 4000, creep: 100 });
    check('spending some of a raise saves less than banking it all',
      halfCreep < noCreep, `$${halfCreep.toLocaleString()} vs $${noCreep.toLocaleString()}`);
    check('and spending all of it saves less again',
      allCreep < halfCreep, `$${allCreep.toLocaleString()}`);
    check('half a raise is spent, so half the extra is kept',
      near(halfCreep, (noCreep + allCreep) / 2, 0.5),
      `$${halfCreep.toLocaleString()} vs midpoint $${Math.round((noCreep + allCreep) / 2).toLocaleString()}`);
    // With no raise there is nothing to creep into, so the lever is inert.
    check('with no raise, creep changes nothing',
      await run({ gross: 100000, monthly: 4000, creep: 100 })
      === await run({ gross: 100000, monthly: 4000, creep: 0 }));

    console.log('\n--- The retirement budget follows the pay you finish on ---');
    /* A replacement rate is a share of PRE-RETIREMENT income. Reading it off
       today's salary made thirty years of raises free: the pot grew with
       every promotion and the spending it had to cover never did. */
    /* Isolated by spending the whole of every raise, so both careers bank
       exactly the same each year and the ONLY thing the raise changes is
       the retirement budget it has to fund. */
    const rep = raise => runAt({ age: 30, gross: 100000, netWorth: 3000000, raiseNom: raise,
      inflation: 0, creep: 100, monthly: 0, stopWork: 40, retireAge: 40, runTo: 41,
      retireProfile: 'generous' }, 41);
    const flat = await rep(0), grown = await rep(5);
    /* Earning from 30 to 39 is ten years but NINE raises - the first one
       lands after a year - so pay finishes at 100000 x 1.05^9 = $155,133.
       At a 100% replacement rate that is exactly what the extra year of
       retirement costs. Reading the rate off today's pay made it free. */
    check('a career of raises makes retirement cost more, not the same',
      near(flat - grown, 100000 * Math.pow(1.05, 9) - 100000, 1),
      `flat $${flat.toLocaleString()} vs grown $${grown.toLocaleString()}`
      + ` — gap $${Math.round(flat - grown).toLocaleString()}`);

    console.log('\n--- Withdrawals are taxed on the gain, not the whole ---');
    // Age 59 rather than 60: you cannot retire at the age you already are,
    // and the tab clamps retirement to at least a year out.
    const gains = t => runAt({ age: 59, netWorth: 500000, pBrok: 100, pRet: 0,
      realReturn: 0, stopWork: 60, retireAge: 60, runTo: 70,
      retireProfile: 'custom', retireSpend: 20000, gainsTax: t }, 70);
    const noTax = await gains(0), withTax = await gains(20);
    check('a pot that never grew is all basis, so nothing is owed on it',
      noTax === withTax && noTax === 300000,
      `$${noTax.toLocaleString()} vs $${withTax.toLocaleString()}`);
    const grownPot = t => runAt({ age: 29, netWorth: 1000000, pBrok: 100, pRet: 0,
      realReturn: 6, stopWork: 30, retireAge: 30, runTo: 60,
      retireProfile: 'custom', retireSpend: 40000, gainsTax: t }, 60);
    const gFree = await grownPot(0), gTaxed = await grownPot(30);
    check('but a pot that has grown pays on the gain share',
      gTaxed < gFree - 10000, `$${gTaxed.toLocaleString()} vs $${gFree.toLocaleString()}`);

    console.log('\n--- A mortgage payment shrinks in real terms ---');
    /* The payment is fixed in NOMINAL dollars while this whole model is in
       today's. Charging the full amount for thirty years overstated the cost
       of every house - by more, the higher inflation runs. */
    const house = infl => runAt({ age: 30, netWorth: 900000, gross: 0, inflation: infl,
      stopWork: 30, retireAge: 30, runTo: 60, retireProfile: 'custom', retireSpend: 0,
      buys: [{ kind: 'house', label: 'Home', year: new Date().getFullYear(), price: 300000,
               plan: 'c20', down: 60000, rate: 6, term: 30, growth: 0, pmi: 0 }] }, 60);
    const noInfl = await house(0), someInfl = await house(3);
    // 30 years of $17,267 nominal payments discounted at 3% is $348,600 of
    // today's money, not $518,000 - a $170k difference on one house.
    check('the same mortgage costs less when inflation is running',
      someInfl > noInfl + 100000,
      `at 0%: $${noInfl.toLocaleString()} · at 3%: $${someInfl.toLocaleString()}`);
    await ctx.close();
  }

  console.log('\n=== Children show up on the chart ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    // Born in 2030: college runs from 2048 to 2052, ages 35 to 39 for a
    // 31-year-old today, which is well inside the plotted range.
    await page.addInitScript(st => localStorage.setItem('FINANCIAL_FUTURE_STATE', JSON.stringify(st)),
      Object.assign({}, ZERO, { age: 31, gross: 120000, netWorth: 200000, runTo: 70,
        stopWork: 65, retireAge: 65, monthly: 3000,
        kids: [{ label: 'Robin', birthYear: 2030, plan: 'public' }] }));
    await page.goto(URL);
    await page.waitForTimeout(900);
    await open(page);

    const rects = await page.evaluate(() => [...document.querySelectorAll('#finCone rect')]
      .filter(r => r.getAttribute('fill'))
      .map(r => ({ x: +r.getAttribute('x'), w: +r.getAttribute('width'), o: +r.getAttribute('opacity') })));
    check('the dependent years are shaded', rects.length >= 2, `${rects.length} bands`);
    const college = rects.slice().sort((a, b) => b.o - a.o)[0];
    const dependent = rects.slice().sort((a, b) => b.w - a.w)[0];
    check('and the four college years are picked out darker',
      college && dependent && college.o > dependent.o && college.w < dependent.w,
      JSON.stringify({ college, dependent }));
    check('the college band is labelled with the child',
      await page.evaluate(() => [...document.querySelectorAll('#finCone text')]
        .some(t => /Robin/.test(t.textContent))),
      await page.evaluate(() => [...document.querySelectorAll('#finCone text')]
        .map(t => t.textContent).join('|').slice(0, 120)));
    // The band has to sit UNDER the data, or it paints over the median line.
    check('the shading is behind the cone, not over it', await page.evaluate(() => {
      const kids = [...document.getElementById('finCone').children];
      const lastRect = kids.map((k, i) => [k, i]).filter(([k]) =>
        k.tagName === 'rect' && k.getAttribute('fill')).pop();
      const poly = kids.findIndex(k => k.tagName === 'polygon');
      return lastRect && poly > -1 && lastRect[1] < poly;
    }));

    /* The readout has to say WHY the line dips there. A shaded band with no
       number is decoration; naming the stage and the cost is the point. */
    // Born 2030, so college is 2048-2051 - ages 53 to 56 for a 31-year-old.
    const cost = await page.evaluate(() => finKidsAt_(53));
    check('the readout knows what a college year costs',
      cost.total === 29910 && /college/i.test(cost.what), JSON.stringify(cost));
    const mid = await page.evaluate(() => finKidsAt_(45));
    check('and what a school year costs', mid.total === 6000 && /school/i.test(mid.what),
      JSON.stringify(mid));
    const school = await page.evaluate(() => finKidsAt_(31));
    check('and charges nothing before the child is born', school.total === 0, JSON.stringify(school));
    const after = await page.evaluate(() => finKidsAt_(60));
    check('and nothing once they are through', after.total === 0, JSON.stringify(after));

    // Money actually leaves: the same child, on and off.
    const withKid = await med(page);
    await page.evaluate(() => { FIN.kids = []; renderFinancialTab(); });
    await page.waitForTimeout(700);
    const without = await med(page);
    check('a child costs real money in the projection', without > withKid,
      `$${withKid.toLocaleString()} with · $${without.toLocaleString()} without`);
    await ctx.close();
  }

  console.log('\n=== A half-typed age cannot destroy its neighbour ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.goto(URL);
    await page.waitForTimeout(900);
    await open(page);
    await page.evaluate(() => openFinancialEdit());
    await page.waitForTimeout(400);
    const ages = () => page.evaluate(() => ({
      stop: +document.getElementById('fin_stopWork').value,
      retire: +document.getElementById('fin_retireAge').value }));
    const before = await ages();
    // 60 -> 65 goes through "6". That used to clamp stopWork to age+1 forever.
    const el = await page.$('#fin_retireAge');
    await el.click({ clickCount: 3 });
    await page.keyboard.press('Backspace'); await page.waitForTimeout(300);
    await page.keyboard.type('6'); await page.waitForTimeout(500);
    const mid = await ages();
    check('typing "6" leaves the other ages alone', mid.stop === before.stop, JSON.stringify(mid));
    await page.keyboard.type('5'); await page.waitForTimeout(600);
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(600);
    const after = await ages();
    check('and 65 lands with the stop age intact',
      after.retire === 65 && after.stop === before.stop, JSON.stringify(after));
    /* The damage this bug did was invisible in the input boxes - they read
       back fine while the MODEL held a corrupted stop age and reported the
       plan broke. So compare the outcome against the same plan set from
       code: if typing 65 left anything behind, these disagree. */
    const typed = await page.evaluate(() => Math.round(finSimulate_().success * 100));
    const clean = await page.evaluate(() => {
      Object.assign(FIN, JSON.parse(JSON.stringify(FIN_DEFAULTS)), { retireAge: 65 });
      return Math.round(finSimulate_().success * 100);
    });
    check('and the model agrees with a plan set from code, not just the boxes',
      Math.abs(typed - clean) <= 4, `typed ${typed}% vs set ${clean}%`);
    await ctx.close();
  }

  console.log('\n=== What you type is kept ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.goto(URL);
    await page.waitForTimeout(900);
    await open(page);
    await page.evaluate(() => openFinancialEdit());
    await page.waitForTimeout(400);
    await page.fill('#fin_netWorth', '234567');
    await page.waitForTimeout(700);
    await page.evaluate(() => finAdd_('promo'));
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForTimeout(900);
    await open(page);
    await page.evaluate(() => openFinancialEdit());
    await page.waitForTimeout(500);
    check('a figure survives a reload', await page.evaluate(() =>
      document.getElementById('fin_netWorth').value === '234567'),
      await page.evaluate(() => document.getElementById('fin_netWorth').value));
    check('and so does a row you added', await page.evaluate(() =>
      document.querySelectorAll('.fin-row[data-fin-kind="promo"]').length === 1));
    await ctx.close();
  }

  console.log('\n=== A recalibrated profile does not leave stale numbers behind ===');
  {
    /* The return and volatility are saved alongside the profile that set
       them. Recalibrate the profile and a saved plan would otherwise show
       the new label over last year's figure - the dropdown reading
       "Balanced" while the model quietly ran a number nobody chose. And a
       profile that no longer exists has to land somewhere real. */
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.addInitScript(() => localStorage.setItem('FINANCIAL_FUTURE_STATE',
      JSON.stringify({ marketProfile: 'balanced', realReturn: 5, vol: 11, retireProfile: 'standard' })));
    await page.goto(URL);
    await page.waitForTimeout(900);
    await open(page);
    const m = await page.evaluate(() => ({ p: FIN.marketProfile, r: FIN.realReturn,
      table: FIN_MARKET.balanced.ret }));
    check('a named profile is the authority, not the stored number',
      m.r === m.table, `profile says ${m.table}%, plan holds ${m.r}%`);
    check('and the forward-looking figure is below the historic one',
      m.table < 5, `${m.table}% vs 5%`);

    // A later init script wins, so this replaces the seed above on reload.
    await page.addInitScript(() => localStorage.setItem('FINANCIAL_FUTURE_STATE',
      JSON.stringify({ marketProfile: 'gone-since', realReturn: 4.2, vol: 9 })));
    await page.reload();
    await page.waitForTimeout(900);
    await open(page);
    const g = await page.evaluate(() => ({ p: FIN.marketProfile, r: FIN.realReturn }));
    check('a profile that no longer exists becomes Custom', g.p === 'custom', g.p);
    check('and keeps the numbers rather than jumping to a default', g.r === 4.2, String(g.r));
    check('the dropdown can actually show it', await page.evaluate(() => {
      openFinancialEdit();
      const el = document.getElementById('fin_marketProfile');
      return el && el.value === 'custom';
    }));
    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
