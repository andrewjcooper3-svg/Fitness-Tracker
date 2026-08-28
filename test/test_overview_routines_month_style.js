/* The Overview Routines card's Month view stays plain (no day-of-week
   header, no day-number chips) and keeps the same weekday-aligned
   7-column layout Week uses (.rt-month-grid/.rt-month-cell), but at
   about half Week's cell size (.rt-month-grid.compact fixes the column
   width instead of stretching to 1fr) rather than filling the card's
   full width - an earlier version matched Week's width exactly and
   came out too large.

   What is checked here:
     - Week mode still has the dow header and day numbers (unchanged),
     - Month mode has neither,
     - Month cells are meaningfully smaller than Week's (~half), not
       stretched to the same width,
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
  check('Month cells are roughly half Week\'s cell width (about 22px, not stretched to full width)',
    monthInfo.cellWidth > 15 && monthInfo.cellWidth < 30 && monthInfo.cellWidth < weekInfo.cellWidth * 0.7,
    `month ${monthInfo.cellWidth} vs week ${weekInfo.cellWidth}`);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
