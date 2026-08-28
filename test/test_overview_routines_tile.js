/* The Routines glance tile on Overview - a quick "how am I doing today"
   without leaving the home tab, matching the same small-tile shape as
   Weight/Kitchen/Shopping (icon + label left, a short preview right).

   What is checked here:
     - an empty habit list prompts you to set one up, rather than showing
       a bare 0/0 or an error,
     - the fraction shown only counts fixed-schedule (daily/specific-day)
       habits, same as the Routines tab's own ring - an X-times-a-week
       habit isn't "due" on any one day and would only muddy "3 of 5",
     - it updates live as habits are checked off from the Routines tab,
     - tapping the tile navigates to Routines,
     - it carries data-block, so it can be dragged/reordered/hidden the
       same way every other Overview tile can. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 430, height: 950 } });
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('=== Empty state ===');
  const tileExists = await page.evaluate(() => !!document.querySelector('.ov-glance-tile[data-widget="routines"]'));
  check('the tile exists on Overview', tileExists);
  const empty = await page.evaluate(() => document.getElementById('ovRoutinesPreview').textContent.trim());
  check('prompts setup rather than showing 0/0', /Tap to set up habits/.test(empty), empty);

  console.log('\n=== Reflects real habit state, live ===');
  await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Read';
    rtSetCadence('daily');
    rtSaveHabit();
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Stretch';
    rtSetCadence('daily');
    rtSaveHabit();
    // A weekly-target habit must not count toward the daily fraction.
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Guitar';
    rtSetCadence('week');
    rtSaveHabit();
    showAppView('overview');
  });
  await page.waitForTimeout(300);
  const beforeCheck = await page.evaluate(() => document.getElementById('ovRoutinesPreview').textContent.trim());
  check('shows 0/2 (the weekly habit is excluded from the fraction)', /0\/2/.test(beforeCheck), beforeCheck);

  await page.evaluate(() => {
    showAppView('routines');
    document.querySelectorAll('#rtTodayList .rt-check')[0].click();
    showAppView('overview');
  });
  await page.waitForTimeout(300);
  const afterCheck = await page.evaluate(() => document.getElementById('ovRoutinesPreview').textContent.trim());
  check('updates to 1/2 immediately after a check-off elsewhere', /1\/2/.test(afterCheck), afterCheck);

  console.log('\n=== Navigation and layout participation ===');
  await page.evaluate(() => document.querySelector('.ov-glance-tile[data-widget="routines"]').click());
  await page.waitForTimeout(300);
  const active = await page.evaluate(() => document.querySelector('.app-tab.active').dataset.view);
  check('tapping the tile opens the Routines tab', active === 'routines', active);

  const block = await page.evaluate(() => document.querySelector('.ov-glance-tile[data-widget="routines"]').dataset.block);
  check('carries data-block so Edit-mode can rearrange/hide it like any other tile', block === 'routines', block);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  check('Overview still does not scroll sideways with the new tile added', !overflow);

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
