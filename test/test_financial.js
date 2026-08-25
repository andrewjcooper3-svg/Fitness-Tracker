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
const med = page => page.evaluate(() => {
  const m = document.getElementById('finReadout').textContent.match(/median \$([\d,]+)/);
  return m ? +m[1].replace(/,/g, '') : null;
});

// Everything off; each case turns on only what it is testing.
const ZERO = {
  age: 30, netWorth: 0, gross: 0, taxRate: 0, k401: 0, match: 0, monthly: 0, credit: 750,
  inflation: 0, raiseNom: 0, promoNom: 0, promoMin: 1, promoMax: 1, promoStretch: 0, promoUntil: 99,
  pCash: 0, pBrok: 0, pRet: 100, toCash: 0, cashReal: 0, brokDrag: 0, retireTax: 0,
  retireProfile: 'custom', retireSpend: 0, stopWork: 40, retireAge: 40, runTo: 50,
  ssAnnual: 0, ssAge: 67, marketProfile: 'custom', realReturn: 0, vol: 0,
  promos: [], rewards: [], kids: [], buys: []
};

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
    check('10 working years x $100k = $1,000,000', await run({ gross: 100000 }) === 1000000);
    const comp = await run({ netWorth: 100000, realReturn: 5 });
    check('$100k at 5% real for 10 years', near(comp, 100000 * Math.pow(1.05, 10), 0.02),
      `$${comp.toLocaleString()} vs $${Math.round(100000 * Math.pow(1.05, 10)).toLocaleString()}`);
    const k = await run({ gross: 100000, taxRate: 25, k401: 10, match: 5 });
    check('401k is pre-tax and the match is added', k === (10000 + 5000 + 67500) * 10, `$${k.toLocaleString()}`);
    const raise = await run({ gross: 100000, raiseNom: 3, inflation: 3 });
    check('a raise equal to inflation is no raise', raise === 1000000, `$${raise.toLocaleString()}`);
    // The median must sit BELOW naive compounding - that is volatility drag,
    // and it is the whole reason for showing a band rather than a line.
    const vol = await run({ netWorth: 100000, realReturn: 5, vol: 20 });
    const mu = Math.log(1.05) - 0.02;
    check('the lognormal median follows exp(mu*n)', near(vol, 100000 * Math.exp(mu * 10), 6),
      `$${vol.toLocaleString()} vs $${Math.round(100000 * Math.exp(mu * 10)).toLocaleString()}`);
    check('and is below the naive compound figure', vol < 100000 * Math.pow(1.05, 10));
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
    check('the plan is not reported as broke', await page.evaluate(() =>
      document.getElementById('finPill').textContent !== 'Runs out'),
      await page.evaluate(() => document.getElementById('finPill').textContent));
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

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
