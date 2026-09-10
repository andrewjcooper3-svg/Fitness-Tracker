/* Feature request: the Worth It calculator judged every item in
   isolation against the FULL monthly wants budget, so several
   independently-priced items could each earn "Buy it" even though
   buying all of them together would blow the actual monthly budget.
   Wanted: a way to cap how much of the wants budget gets committed in
   one month (half, by default, adjustable), plus a way to rank
   competing items by priority so the app tells you which of them to
   actually buy this month and which to hold off on - worked example
   given: rank 1 ($200) and rank 2 ($200) can't both fit under a $350
   cap, but rank 1 and a cheaper rank 3 ($150) can (they add to exactly
   $350), so the answer should be "buy 1 and 3, hold off on 2," not just
   "hold off on 2" in isolation.

   What is checked here:
     - the new "Max % of wants budget to commit per month" field exists,
       defaults to 50%, and persists across a reload,
     - checking "This month" on three logged items and ranking them
       1/2/3 produces exactly the worked example: buy #1, hold #2, buy
       #3 - not a naive "stop at the first one that doesn't fit",
     - the summary line reports the right committed total and cap,
     - reordering rank changes the outcome (moving the $150 item to rank
       2 instead of 3 changes what gets bought),
     - unchecking an item removes it from the monthly competition and
       reflows the remaining ranks,
     - items never checked for "This month" are untouched - they keep
       their own plain, individual verdict and don't show a rank. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('financial'); finSetTab_('worthit'); });
  await page.waitForTimeout(300);

  console.log('=== The cap-percent field exists and defaults to 50% ===');
  const capDefault = await page.evaluate(() => document.getElementById('wiMonthlyCapPct').value);
  check('defaults to 50', capDefault === '50', capDefault);

  await page.evaluate(() => { document.getElementById('wiWants').value = '700'; document.getElementById('wiWants').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);

  const logItem = async (name, price) => {
    await page.evaluate(({ name, price }) => {
      document.getElementById('wiItemName').value = name;
      document.getElementById('wiItemName').dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('wiPrice').value = String(price);
      document.getElementById('wiPrice').dispatchEvent(new Event('input', { bubbles: true }));
      wiRecalc_();
      wiLogCurrentItem_();
    }, { name, price });
    await page.waitForTimeout(100);
  };

  console.log('\n=== Logging three items: $200, $200, $150 ===');
  await logItem('Item A', 200);
  await logItem('Item B', 200);
  await logItem('Item C', 150);

  const ids = await page.evaluate(() => WI_LOG.items.map(it => ({ id: it.id, name: it.name })));
  const idFor = name => ids.find(x => x.name === name).id;

  console.log('\n=== Checking "This month" on all three, in order A, B, C (rank 1, 2, 3) ===');
  await page.evaluate((ids3) => { ids3.forEach(id => wiToggleMonthlyPlan_(id)); }, [idFor('Item A'), idFor('Item B'), idFor('Item C')]);
  await page.waitForTimeout(100);

  const plan1 = await page.evaluate(() => wiComputeMonthlyPlan_().results.map(r => ({ name: r.item.name, buy: r.buy })));
  console.log('  plan:', JSON.stringify(plan1));
  check('rank 1 ($200) is bought', plan1[0].name === 'Item A' && plan1[0].buy === true, JSON.stringify(plan1[0]));
  check('rank 2 ($200) is held off (200+200=400 > 350 cap)', plan1[1].name === 'Item B' && plan1[1].buy === false, JSON.stringify(plan1[1]));
  check('rank 3 ($150) is STILL bought despite rank 2 not fitting (200+150=350 <= 350)', plan1[2].name === 'Item C' && plan1[2].buy === true, JSON.stringify(plan1[2]));

  console.log('\n=== The summary line reports the right committed total and cap ===');
  const note = await page.evaluate(() => document.getElementById('wiMonthlyPlanNote').textContent);
  check('reports $350.00 of $350.00 committed', /\$350\.00 of \$350\.00 committed/.test(note), note);
  check('reports 50% of $700.00 wants budget', /50% of \$700\.00 wants budget/.test(note), note);

  console.log('\n=== Reordering: moving Item C to rank 2 (ahead of Item B) changes the outcome ===');
  await page.evaluate((id) => { wiBumpRank_(id, -1); }, idFor('Item C')); // swaps with whoever is directly above it
  await page.waitForTimeout(100);
  const plan2 = await page.evaluate(() => wiComputeMonthlyPlan_().results.map(r => ({ name: r.item.name, buy: r.buy })));
  console.log('  plan after reorder:', JSON.stringify(plan2));
  check('Item C is now rank 2 and still bought (200+150=350)', plan2[1].name === 'Item C' && plan2[1].buy === true, JSON.stringify(plan2));
  check('Item B is now rank 3 and held off (350+200 would exceed cap)', plan2[2].name === 'Item B' && plan2[2].buy === false, JSON.stringify(plan2));

  console.log('\n=== Unchecking Item A removes it from the competition and reflows ranks ===');
  await page.evaluate((id) => wiToggleMonthlyPlan_(id), idFor('Item A'));
  await page.waitForTimeout(100);
  const plan3 = await page.evaluate(() => wiComputeMonthlyPlan_().results.map(r => r.item.name));
  check('only Item C and Item B remain in the plan', plan3.length === 2 && !plan3.includes('Item A'), JSON.stringify(plan3));

  console.log('\n=== A row never checked for "This month" keeps its own plain verdict, no rank shown ===');
  await logItem('Item D', 50);
  await page.waitForTimeout(200);
  const rowD = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#wiLogList .wi-log-row')].find(r => r.textContent.includes('Item D'));
    return { hasRank: !!row.querySelector('.wi-log-row-rank'), hasCheckbox: !!row.querySelector('[data-toggle-id]'), checked: row.querySelector('[data-toggle-id]').checked };
  });
  check('Item D has a checkbox but it is unchecked', rowD.hasCheckbox && !rowD.checked, JSON.stringify(rowD));
  check('Item D shows no rank control (not in the monthly plan)', !rowD.hasRank, JSON.stringify(rowD));

  console.log('\n=== The cap-percent field persists across a reload ===');
  await page.evaluate(() => { document.getElementById('wiMonthlyCapPct').value = '40'; document.getElementById('wiMonthlyCapPct').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('financial'); finSetTab_('worthit'); });
  await page.waitForTimeout(300);
  const capAfterReload = await page.evaluate(() => document.getElementById('wiMonthlyCapPct').value);
  check('the cap percent survived the reload', capAfterReload === '40', capAfterReload);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
