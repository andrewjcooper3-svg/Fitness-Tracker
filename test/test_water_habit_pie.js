// A threshold-linked habit (Water, Pushups) isn't checked off by hand -
// rtIsDoneOn flips it on its own once the day's logged value clears the
// threshold. This checks the purely-visual pie-fill added to its checkbox
// (.rt-link-progress, --fill custom property): it should track partial
// progress toward the threshold, disappear once the habit is actually
// done (the solid .done fill takes over instead), and never itself count
// as "done" - a habit sitting at 90% must still read as not done.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    RT_HABITS.list.push({ id: 'h_water_test', name: 'Water', cadence: 'daily', created: null,
      link: { source: 'water', threshold: 100 } });
    rtHabitsChanged();
    localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify({}));
    showAppView('routines');
  });
  await page.waitForTimeout(300);

  const readBox = async () => page.evaluate(() => {
    const row = [...document.querySelectorAll('#rtTodayList .rt-item-row')]
      .find(r => r.querySelector('.rt-item-name').textContent === 'Water');
    const btn = row.querySelector('.rt-check');
    return {
      done: btn.classList.contains('done'),
      progressClass: btn.classList.contains('rt-link-progress'),
      fill: btn.style.getPropertyValue('--fill')
    };
  });

  console.log('=== No water logged yet today ===');
  let box = await readBox();
  check('not done', !box.done, JSON.stringify(box));
  check('pie shows zero fill', box.progressClass && parseFloat(box.fill) === 0, JSON.stringify(box));

  console.log('\n=== Halfway to the threshold ===');
  await page.evaluate(() => {
    const k = dateKey(new Date());
    const ledger = {}; ledger[k] = 50;
    localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify(ledger));
    rtRenderAll();
  });
  await page.waitForTimeout(150);
  box = await readBox();
  check('still not done at 50/100', !box.done, JSON.stringify(box));
  check('pie fill reflects the 50% progress', box.progressClass && Math.abs(parseFloat(box.fill) - 0.5) < 0.01, JSON.stringify(box));

  console.log('\n=== Just short of the threshold (no partial credit) ===');
  await page.evaluate(() => {
    const k = dateKey(new Date());
    const ledger = {}; ledger[k] = 99;
    localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify(ledger));
    rtRenderAll();
  });
  await page.waitForTimeout(150);
  box = await readBox();
  check('99/100 still reads as not done', !box.done, JSON.stringify(box));
  check('pie fill is nearly full but not marked done', box.progressClass && parseFloat(box.fill) > 0.9, JSON.stringify(box));

  console.log('\n=== Threshold cleared ===');
  await page.evaluate(() => {
    const k = dateKey(new Date());
    const ledger = {}; ledger[k] = 110;
    localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify(ledger));
    rtRenderAll();
  });
  await page.waitForTimeout(150);
  box = await readBox();
  check('now reads as done', box.done, JSON.stringify(box));
  check('the pie-progress class is gone once done (solid fill takes over)', !box.progressClass, JSON.stringify(box));

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
