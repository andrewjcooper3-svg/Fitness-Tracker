/* The Financials tab now opens on a new "Worth It" sub-tab by default,
   with the existing net-worth projection moved to a "Future" sub-tab one
   tap away. Worth It itself has two modes - a regular purchase calculator
   wired to pay/tax/401(k) math, and Abbey's Silly Calculator, which plots
   an exponential silliness score for anything over $20. This checks the
   sub-tab defaults, the toggle wiring, the calculator math, the usage
   profile presets, and the silly-calculator's under/over-$20 branches. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => showAppView('financial'));
  await page.waitForTimeout(200);

  console.log('=== Worth It is the default sub-tab, Future is one tap away ===');
  let state = await page.evaluate(() => ({
    worthItVisible: document.getElementById('finTabWorthIt').style.display !== 'none',
    futureVisible: document.getElementById('finTabFuture').style.display !== 'none',
    activeBtn: document.querySelector('#finTopSeg button.active').dataset.finTab
  }));
  check('Worth It is showing on first visit', state.worthItVisible && !state.futureVisible, JSON.stringify(state));
  check('the Worth It tab button is marked active', state.activeBtn === 'worthit');

  await page.evaluate(() => finSetTab_('future'));
  await page.waitForTimeout(100);
  state = await page.evaluate(() => ({
    worthItVisible: document.getElementById('finTabWorthIt').style.display !== 'none',
    futureVisible: document.getElementById('finTabFuture').style.display !== 'none',
    heroText: document.getElementById('finHero').textContent
  }));
  check('switching to Future hides Worth It and shows the projection', !state.worthItVisible && state.futureVisible, JSON.stringify(state));
  check('the Future content actually rendered (finHero populated)', state.heroText.length > 0, state.heroText);

  await page.evaluate(() => finSetTab_('worthit'));
  await page.waitForTimeout(100);

  console.log('\n=== Regular purchase calculator math, with the example item ===');
  const calc = await page.evaluate(() => ({
    netHourly: document.getElementById('wiLineNetHourly').textContent,
    costPerUse: document.getElementById('wiStatCostPerUse').textContent,
    verdictBadge: document.getElementById('wiVerdictBadge').textContent
  }));
  // wage 39 * (0.80 - 0.06) = 39 * 0.74 = 28.86
  check('net hourly reflects the flat 74% multiplier', calc.netHourly === '$28.86', calc.netHourly);
  check('cost per use rendered a real number', /\$\d/.test(calc.costPerUse), calc.costPerUse);
  check('a verdict badge rendered', calc.verdictBadge.length > 0, calc.verdictBadge);

  console.log('\n=== A wage preset drives the input; Custom unlocks manual entry ===');
  const presetState = await page.evaluate(() => ({
    disabledBeforeCustom: document.getElementById('wiWage').disabled,
    wageAfterPreset50: (() => {
      const sel = document.getElementById('wiWagePreset');
      sel.value = '50';
      sel.dispatchEvent(new Event('change'));
      return document.getElementById('wiWage').value;
    })(),
    disabledAfterPreset: document.getElementById('wiWage').disabled,
    disabledAfterCustom: (() => {
      const sel = document.getElementById('wiWagePreset');
      sel.value = 'custom';
      sel.dispatchEvent(new Event('change'));
      return document.getElementById('wiWage').disabled;
    })()
  }));
  check('wage starts disabled (a matching preset is selected)', presetState.disabledBeforeCustom === true);
  check('picking a $50 preset sets the wage input to 50', presetState.wageAfterPreset50 === '50', presetState.wageAfterPreset50);
  check('the input stays disabled while a preset is active', presetState.disabledAfterPreset === true);
  check('switching to Custom re-enables manual entry', presetState.disabledAfterCustom === false);
  // put it back so later checks see the documented default
  await page.evaluate(() => { document.getElementById('wiWagePreset').value = '39'; document.getElementById('wiWagePreset').dispatchEvent(new Event('change')); });

  console.log('\n=== A usage profile fills in frequency and lifespan ===');
  const profileState = await page.evaluate(() => {
    const sel = document.getElementById('wiProfileSelect');
    sel.value = 'sneakers';
    sel.dispatchEvent(new Event('change'));
    return {
      freqVal: document.getElementById('wiFreqVal').value,
      freqUnit: document.getElementById('wiFreqUnit').value,
      lifeVal: document.getElementById('wiLifeVal').value,
      lifeUnit: document.getElementById('wiLifeUnit').value
    };
  });
  check('the sneakers profile set 4/week for a year', profileState.freqVal === '4' && profileState.freqUnit === 'week' && profileState.lifeVal === '1' && profileState.lifeUnit === 'year', JSON.stringify(profileState));

  const revertedToCustom = await page.evaluate(() => {
    const el = document.getElementById('wiFreqVal');
    el.value = '9';
    el.dispatchEvent(new Event('input'));
    return document.getElementById('wiProfileSelect').value;
  });
  check('hand-editing a field reverts the profile picker to Custom', revertedToCustom === 'custom', revertedToCustom);

  console.log('\n=== Abbey\'s Silly Calculator: under vs. over the $20 line ===');
  await page.evaluate(() => wiSetMode_('silly'));
  await page.waitForTimeout(100);
  let sillyState = await page.evaluate(() => ({
    overVisible: document.getElementById('wiSillyOverPanel').style.display !== 'none',
    underVisible: document.getElementById('wiSillyUnderPanel').style.display !== 'none',
    hasChart: document.getElementById('wiSillyChartWrap').innerHTML.includes('<svg')
  }));
  check('the $65 example item shows the over-$20 chart panel', sillyState.overVisible && !sillyState.underVisible, JSON.stringify(sillyState));
  check('a chart actually rendered', sillyState.hasChart);

  await page.evaluate(() => {
    document.getElementById('wiSillyPrice').value = '10';
    document.getElementById('wiSillyPrice').dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(100);
  sillyState = await page.evaluate(() => ({
    overVisible: document.getElementById('wiSillyOverPanel').style.display !== 'none',
    underVisible: document.getElementById('wiSillyUnderPanel').style.display !== 'none'
  }));
  check('a $10 item switches to the under-$20 allowance panel', !sillyState.overVisible && sillyState.underVisible, JSON.stringify(sillyState));

  const monthlyAllowance = await page.evaluate(() => {
    const box = document.getElementById('wiSillyUsedCheckbox');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    return document.getElementById('wiSillyWarnNote').style.display;
  });
  check('checking the monthly allowance box surfaces the warning note', monthlyAllowance !== 'none', monthlyAllowance);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
