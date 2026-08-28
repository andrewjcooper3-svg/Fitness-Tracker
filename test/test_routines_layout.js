/* Keeping the habit list compact as it grows, and giving weekly-target
   habits their due on the calendar.

   What is checked here:
     - rows are meaningfully shorter than the original two-line design,
     - past ROUTINES_2COL_THRESHOLD habits, the list (both the Routines
       tab's Today list and the Overview hero card) switches to two CSS
       columns rather than just growing taller, and drops back to one
       column once the count is low again,
     - the "This week, any day" group label still spans both columns
       instead of getting squeezed into one,
     - a weekly-target habit completed on a given day earns a GREEN
       section on that day's calendar cell - but a day it was due-but-
       not-done never gets a section at all (it's not "due" on any one
       day, so it must never read as missed), and the day-detail panel
       shows it too when that day is selected. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('=== Hero card border ===');
  const borderColor = await page.evaluate(() => getComputedStyle(document.querySelector('.ov-hero-routines')).borderColor);
  check('the Routines hero card has its own accent border color', borderColor && borderColor !== 'rgb(0, 0, 0)', borderColor);

  console.log('\n=== Compact rows + two-column overflow ===');
  await page.evaluate(() => {
    showAppView('routines');
    for (let i = 1; i <= 8; i++) {
      rtOpenHabitSheet();
      document.getElementById('rtHName').value = 'Habit ' + i;
      rtSetCadence('daily');
      rtSaveHabit();
    }
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Guitar practice';
    rtSetCadence('week');
    rtSaveHabit();
  });
  await page.waitForTimeout(300);

  const rowHeight = await page.evaluate(() => document.querySelector('#rtTodayList .rt-item-row').getBoundingClientRect().height);
  check('rows are compact (under 40px, down from the original ~46px two-line design)', rowHeight < 40, String(rowHeight));

  check('Routines tab list goes 2-column above the threshold',
    await page.evaluate(() => document.getElementById('rtTodayList').classList.contains('rt-item-list-2col')));
  check('CSS actually renders 2 columns',
    (await page.evaluate(() => getComputedStyle(document.getElementById('rtTodayList')).columnCount)) === '2');
  check('the weekly-habits group label spans across both columns',
    (await page.evaluate(() => getComputedStyle(document.querySelector('#rtTodayList .rt-item-group-label')).columnSpan)) === 'all');

  await page.evaluate(() => showAppView('overview'));
  await page.waitForTimeout(300);
  check('the Overview hero card list also goes 2-column with the same habits',
    await page.evaluate(() => document.getElementById('ovRoutinesList').classList.contains('rt-item-list-2col')));

  await page.evaluate(() => {
    const ids = RT_HABITS.list.filter(h => !h.deleted && h.cadence !== 'week').map(h => h.id).slice(0, 7);
    ids.forEach(id => rtDeleteHabit(id));
  });
  await page.waitForTimeout(300);
  check('drops back to a single column once habit count is low again',
    (await page.evaluate(() => document.getElementById('ovRoutinesList').classList.contains('rt-item-list-2col'))) === false);

  console.log('\n=== Weekly-habit completion shows a green day, never a missed one ===');
  await page.evaluate(() => {
    const guitar = RT_HABITS.list.find(h => h.name === 'Guitar practice');
    rtToggle(guitar.id, rtToday);
    showAppView('routines');
  });
  await page.waitForTimeout(200);

  const todaySections = await page.evaluate(() => {
    const cell = document.querySelector(`#rtMonthGrid [data-date="${dateKey(rtToday)}"]`);
    return cell ? [...cell.querySelectorAll('.rt-day-sections > span')].map(s => ({ cls: s.className, title: s.title })) : null;
  });
  check('today (the day it was completed) gets a green section for the weekly habit',
    todaySections && todaySections.some(s => s.cls === 'rt-sec-done' && s.title === 'Guitar practice'), JSON.stringify(todaySections));

  const yesterdayTitles = await page.evaluate(() => {
    const cell = document.querySelector(`#rtMonthGrid [data-date="${dateKey(new Date(rtToday.getTime() - ROUTINES_DAY_MS))}"]`);
    return cell ? [...cell.querySelectorAll('.rt-day-sections > span')].map(s => s.title) : [];
  });
  check('yesterday (not completed) has no section for it at all - never reads as missed', !yesterdayTitles.includes('Guitar practice'), JSON.stringify(yesterdayTitles));

  await page.evaluate(() => rtSelectDay(dateKey(rtToday)));
  await page.waitForTimeout(150);
  const detailText = await page.evaluate(() => document.getElementById('rtHeatDetail').textContent);
  check('the day-detail panel lists the completed weekly habit for that day', /Guitar practice/.test(detailText), detailText);

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
