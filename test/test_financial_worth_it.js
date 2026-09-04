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

  console.log('\n=== Already-have-one and necessity reshape the verdict, on top of the raw math ===');
  await page.evaluate(() => {
    document.getElementById('wiPrice').value = '30';       // cheap enough that raw math alone says "Buy it"
    document.getElementById('wiPrice').dispatchEvent(new Event('input'));
  });
  const baseline = await page.evaluate(() => document.getElementById('wiVerdictBadge').textContent);
  check('a cheap item reads "Buy it" on the raw numbers alone', baseline === 'Buy it', baseline);

  const dupState = await page.evaluate(() => {
    document.getElementById('wiHaveSimilar').value = 'works';
    document.getElementById('wiHaveSimilar').dispatchEvent(new Event('change'));
    return {
      badge: document.getElementById('wiVerdictBadge').textContent,
      line3: document.getElementById('wiVerdictLine3').textContent,
      line3Visible: document.getElementById('wiVerdictLine3').style.display !== 'none'
    };
  });
  check('owning a working duplicate overrides the verdict to Skip it', dupState.badge === 'Skip it', dupState.badge);
  check('the override reason is shown', dupState.line3Visible && /duplicate/i.test(dupState.line3), dupState.line3);

  await page.evaluate(() => { document.getElementById('wiHaveSimilar').value = 'none'; document.getElementById('wiHaveSimilar').dispatchEvent(new Event('change')); });
  const brokenState = await page.evaluate(() => {
    document.getElementById('wiPrice').value = '900';      // pricey enough that raw math alone says "Skip it"
    document.getElementById('wiPrice').dispatchEvent(new Event('input'));
    const before = document.getElementById('wiVerdictBadge').textContent;
    document.getElementById('wiHaveSimilar').value = 'broken';
    document.getElementById('wiHaveSimilar').dispatchEvent(new Event('change'));
    return { before, after: document.getElementById('wiVerdictBadge').textContent, line3: document.getElementById('wiVerdictLine3').textContent };
  });
  check('an expensive item alone reads Skip it', brokenState.before === 'Skip it', brokenState.before);
  check('marking the old one broken nudges the verdict up a tier', brokenState.after === 'Worth considering', brokenState.after);
  check('the replacement reasoning is shown', /replace something broken/i.test(brokenState.line3), brokenState.line3);
  await page.evaluate(() => { document.getElementById('wiHaveSimilar').value = 'none'; document.getElementById('wiHaveSimilar').dispatchEvent(new Event('change')); document.getElementById('wiPrice').value = '380'; document.getElementById('wiPrice').dispatchEvent(new Event('input')); });

  console.log('\n=== Log this item, then open, edit and delete it from the list ===');
  await page.evaluate(() => document.getElementById('wiLogItemBtn').click());
  await page.waitForTimeout(100);
  let logState = await page.evaluate(() => ({
    count: WI_LOG.items.length,
    cardVisible: document.getElementById('wiLogListCard').style.display !== 'none',
    rowName: document.querySelector('#wiLogList .wi-log-row-name') ? document.querySelector('#wiLogList .wi-log-row-name').textContent : null
  }));
  check('logging the item adds it to WI_LOG', logState.count === 1, logState.count);
  check('the logged-items card becomes visible', logState.cardVisible);
  check('the row shows the item name', logState.rowName === 'Stand mixer', logState.rowName);

  await page.evaluate(() => document.querySelector('#wiLogList .wi-log-row').click());
  await page.waitForTimeout(100);
  const detail = await page.evaluate(() => {
    const rect = document.getElementById('wiDetailModal').getBoundingClientRect();
    return {
      modalVisible: document.getElementById('wiDetailModal').style.display !== 'none',
      name: document.getElementById('wiDetailName').textContent,
      price: document.getElementById('wiDetailPrice').textContent,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    };
  });
  check('clicking the row opens the detail modal with its data', detail.modalVisible && detail.name === 'Stand mixer' && detail.price === '$380.00', JSON.stringify(detail));
  // #view-financial sits well into the swipe carousel (index 7 of 9), so
  // translateX(-700%) is in effect - if the modal were still nested inside
  // #appViewsTrack, a transformed ancestor becomes its containing block and
  // position:fixed would render it off in that transformed space instead
  // of over the actual viewport (display:flex would still pass, but no
  // pixel of it would be on screen). This is the check that actually
  // catches that, where a visibility check alone would not.
  check('the modal actually renders on screen, not off in transformed carousel space',
    detail.rect.width > 0 && detail.rect.left >= 0 && detail.rect.left < 390 && detail.rect.top >= 0 && detail.rect.top < 844,
    JSON.stringify(detail.rect));

  await page.evaluate(() => document.getElementById('wiEditLogBtn').click());
  await page.waitForTimeout(100);
  const editState = await page.evaluate(() => ({
    modalClosed: document.getElementById('wiDetailModal').style.display === 'none',
    priceInForm: document.getElementById('wiPrice').value,
    btnLabel: document.getElementById('wiLogItemBtn').textContent
  }));
  check('Edit closes the modal and loads the item back into the form', editState.modalClosed && editState.priceInForm === '380', JSON.stringify(editState));
  check('the log button now reads "update" instead of "log"', /update/i.test(editState.btnLabel), editState.btnLabel);

  await page.evaluate(() => {
    document.getElementById('wiPrice').value = '420';
    document.getElementById('wiPrice').dispatchEvent(new Event('input'));
    document.getElementById('wiLogItemBtn').click();
  });
  await page.waitForTimeout(100);
  logState = await page.evaluate(() => ({ count: WI_LOG.items.length, price: WI_LOG.items[0].price, btnLabel: document.getElementById('wiLogItemBtn').textContent }));
  check('re-logging updates the existing entry rather than adding a new one', logState.count === 1 && logState.price === 420, JSON.stringify(logState));
  check('the log button reverts to "Log this item" after saving', logState.btnLabel === 'Log this item', logState.btnLabel);

  await page.evaluate(() => document.querySelector('#wiLogList .wi-log-row').click());
  await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('wiDeleteLogBtn').click());
  await page.waitForTimeout(100);
  logState = await page.evaluate(() => ({
    count: WI_LOG.items.length,
    cardVisible: document.getElementById('wiLogListCard').style.display !== 'none',
    modalClosed: document.getElementById('wiDetailModal').style.display === 'none'
  }));
  check('Delete removes the entry and closes the modal', logState.count === 0 && logState.modalClosed, JSON.stringify(logState));
  check('the logged-items card hides again once empty', !logState.cardVisible);

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
