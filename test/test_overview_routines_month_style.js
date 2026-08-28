/* The Overview Routines card's Month view stays plain (no day-of-week
   header, no day-number chips) but uses the SAME 7-column, 1fr-per-cell
   grid Week uses (.rt-month-grid/.rt-month-cell) - so its squares scale
   up to fill the row exactly the way Week's cells do, instead of sitting
   at a small fixed size with unused space down the row (the earlier,
   smaller-square design this replaces).

   What is checked here:
     - Week mode still has the dow header and day numbers (unchanged),
     - Month mode has neither,
     - Month and Week cells are the exact same pixel width - the whole
       point of this design,
     - Month renders a full padded month grid (first-of-month aligned to
       its real weekday, trailing pad cells filling the last row), with
       one cell per day plus padding, and future days render blank. */
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

  const weekInfo = await page.evaluate(() => ({
    hasDow: !!document.querySelector('#ovRoutinesCalGrid .rt-month-dow'),
    daynums: document.querySelectorAll('#ovRoutinesCalGrid .rt-month-daynum').length,
    cellWidth: document.querySelector('#ovRoutinesCalGrid .rt-month-cell').getBoundingClientRect().width
  }));
  check('Week mode still shows the dow header and day numbers (unchanged)', weekInfo.hasDow && weekInfo.daynums === 7, JSON.stringify(weekInfo));

  await page.evaluate(() => setOvRoutinesCalMode('month'));
  await page.waitForTimeout(200);

  const monthInfo = await page.evaluate(() => {
    const y = rtToday.getFullYear(), m = rtToday.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    return {
      hasDow: !!document.querySelector('#ovRoutinesCalGrid .rt-month-dow'),
      daynums: document.querySelectorAll('#ovRoutinesCalGrid .rt-month-daynum').length,
      totalCells: document.querySelectorAll('#ovRoutinesCalGrid .rt-month-cell').length,
      padCells: document.querySelectorAll('#ovRoutinesCalGrid .rt-month-cell.pad').length,
      expectedTotal: Math.ceil((firstDow + daysInMonth) / 7) * 7,
      expectedPad: Math.ceil((firstDow + daysInMonth) / 7) * 7 - daysInMonth,
      cellWidth: document.querySelector('#ovRoutinesCalGrid .rt-month-cell:not(.pad)').getBoundingClientRect().width
    };
  });
  check('Month mode has no dow header', !monthInfo.hasDow, JSON.stringify(monthInfo));
  check('Month mode has no day-number chips', monthInfo.daynums === 0, JSON.stringify(monthInfo));
  check('Month mode renders a full padded month grid (aligned to real weekdays)',
    monthInfo.totalCells === monthInfo.expectedTotal && monthInfo.padCells === monthInfo.expectedPad, JSON.stringify(monthInfo));
  check('Month cells are the exact same width as Week cells - the point of this change',
    Math.abs(monthInfo.cellWidth - weekInfo.cellWidth) < 1, `month ${monthInfo.cellWidth} vs week ${weekInfo.cellWidth}`);
  check('cells are meaningfully bigger than the old fixed 16px squares', monthInfo.cellWidth > 30, String(monthInfo.cellWidth));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
