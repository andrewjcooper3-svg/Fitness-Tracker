/* The Overview Routines card's Month view is styled to match the
   Routines tab's own Year view exactly - small squares (.rt-year-sq)
   in a free-flowing .rt-year-flow container, no day-of-week header, no
   day-number chips. Week view is untouched (still the larger, labeled
   .rt-month-cell grid), so this is deliberately an asymmetric choice
   between the two calendar modes, not a general style change.

   What is checked here:
     - Week mode still has the dow header and day numbers (unchanged),
     - Month mode has neither,
     - Month mode uses .rt-year-flow/.rt-year-sq, one square per day in
       the month (future days render as blank squares),
     - the squares are the same literal pixel size as the ones in the
       Routines tab's own Year view (same CSS class, exact parity). */
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
  await page.waitForTimeout(1500);
  check('no page errors on load', errors.length === 0, errors.join(' | '));

  await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Read';
    rtSetCadence('daily');
    rtSaveHabit();
    showAppView('overview');
    document.querySelector('.ov-hero-routines .ov-hero-head').click();
  });
  await page.waitForTimeout(200);

  // Week mode should be unchanged (still the larger day-numbered cells).
  const weekInfo = await page.evaluate(() => ({
    hasDow: !!document.querySelector('#ovRoutinesCalGrid .rt-month-dow'),
    daynums: document.querySelectorAll('#ovRoutinesCalGrid .rt-month-daynum').length,
    cellClass: document.querySelector('#ovRoutinesCalGrid .rt-month-cell') ? 'rt-month-cell' : null
  }));
  check('Week mode still shows the dow header and day numbers (unchanged)', weekInfo.hasDow && weekInfo.daynums === 7, JSON.stringify(weekInfo));

  await page.evaluate(() => setOvRoutinesCalMode('month'));
  await page.waitForTimeout(200);

  const monthInfo = await page.evaluate(() => ({
    hasDow: !!document.querySelector('#ovRoutinesCalGrid .rt-month-dow'),
    daynums: document.querySelectorAll('#ovRoutinesCalGrid .rt-month-daynum').length,
    yearSqCount: document.querySelectorAll('#ovRoutinesCalGrid .rt-year-sq').length,
    hasYearFlow: !!document.querySelector('#ovRoutinesCalGrid .rt-year-flow'),
    sqWidth: (() => {
      const sq = document.querySelector('#ovRoutinesCalGrid .rt-year-sq');
      return sq ? sq.getBoundingClientRect().width : null;
    })()
  }));
  check('Month mode has no dow header (matches Year tab style)', !monthInfo.hasDow, JSON.stringify(monthInfo));
  check('Month mode has no day-number chips (matches Year tab style)', monthInfo.daynums === 0, JSON.stringify(monthInfo));
  check('Month mode uses the same small-square flow container as the Year tab', monthInfo.hasYearFlow, JSON.stringify(monthInfo));
  const expectedDayCount = await page.evaluate(() => new Date(rtToday.getFullYear(), rtToday.getMonth() + 1, 0).getDate());
  check('Month mode renders one square per day in the current month (future ones blank)', monthInfo.yearSqCount === expectedDayCount, JSON.stringify(monthInfo) + ' expected ' + expectedDayCount);
  check('squares are small (~16px, matching the Year tab), not the larger month cells', monthInfo.sqWidth < 20, JSON.stringify(monthInfo));

  // Compare pixel size directly against the Routines tab's own Year view squares.
  const routinesYearSqWidth = await page.evaluate(() => {
    showAppView('routines');
    toggleKitchenCollapse_('rtHistoryBody', 'rtHistoryChevron');
    rtSetHistoryMode('year');
    const sq = document.querySelector('#rtYearGrid .rt-year-sq');
    return sq ? sq.getBoundingClientRect().width : null;
  });
  check('matches the exact same square size as the Routines tab Year view', Math.abs(monthInfo.sqWidth - routinesYearSqWidth) < 1, `${monthInfo.sqWidth} vs ${routinesYearSqWidth}`);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
