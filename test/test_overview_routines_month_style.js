/* The Overview Routines card's Month view stays plain (no day-of-week
   header, no day-number chips) and drops Week's weekday-aligned 7-column
   layout entirely: it's a flat flow of small squares, one per day of the
   month (.ov-month-flow/.ov-month-sq), sized with CSS grid-template-columns:
   repeat(auto-fill, minmax(20px, 1fr)) so however many ~20px columns fit
   the card's actual width are stretched evenly to fill it - small like the
   Routines tab's Year view, but full-width like Week, without hardcoding a
   column count. Two earlier versions were tried and rejected: matching
   Week's cell width exactly came out "too big", and a fixed 7-column
   22px-wide layout came out small but didn't fill the block's width.

   What is checked here:
     - Week mode still has the dow header and day numbers (unchanged),
     - Month mode has neither,
     - Month renders exactly one cell per day of the month (no padding
       cells for weekday alignment, unlike Week's grid),
     - Month cells are small (~20px, meaningfully smaller than Week's),
     - the month grid's rendered width matches the card's content width
       (unlike the old fixed-width version, which left empty space),
     - future days render blank. */
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
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const grid = document.getElementById('ovRoutinesCalGrid');
    const flow = grid.querySelector('.ov-month-flow');
    const sqs = [...grid.querySelectorAll('.ov-month-sq')];
    const cardWidth = document.querySelector('.ov-hero-routines').getBoundingClientRect().width;
    return {
      hasDow: !!grid.querySelector('.rt-month-dow'),
      daynums: grid.querySelectorAll('.rt-month-daynum').length,
      totalCells: sqs.length,
      daysInMonth,
      cellWidth: sqs[0].getBoundingClientRect().width,
      flowWidth: flow.getBoundingClientRect().width,
      cardWidth
    };
  });
  check('Month mode has no dow header', !monthInfo.hasDow, JSON.stringify(monthInfo));
  check('Month mode has no day-number chips', monthInfo.daynums === 0, JSON.stringify(monthInfo));
  check('Month mode renders exactly one cell per day of the month (no padding cells)',
    monthInfo.totalCells === monthInfo.daysInMonth, JSON.stringify(monthInfo));
  check('Month cells are small (~20px, meaningfully smaller than Week\'s)',
    monthInfo.cellWidth > 10 && monthInfo.cellWidth < 30 && monthInfo.cellWidth < weekInfo.cellWidth * 0.7,
    `month ${monthInfo.cellWidth} vs week ${weekInfo.cellWidth}`);
  check('the grid fills the card\'s width rather than leaving empty space',
    monthInfo.flowWidth > monthInfo.cardWidth * 0.85, JSON.stringify(monthInfo));

  const futureBlank = await page.evaluate(() => {
    const y = rtToday.getFullYear(), m = rtToday.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    if (rtToday.getDate() >= daysInMonth) return true;
    const sqs = [...document.querySelectorAll('#ovRoutinesCalGrid .ov-month-sq')];
    const lastSq = sqs[sqs.length - 1];
    return lastSq.textContent.trim() === '' && !lastSq.hasAttribute('title');
  });
  check('future days render blank', futureBlank);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
