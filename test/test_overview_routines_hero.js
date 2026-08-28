/* The Routines hero card on Overview - promoted from a small glance tile
   to a full card matching Pushups/Water: a checkable list of today's
   habits in the main column, plus a week/month calendar. Reuses the
   Routines tab's own render primitives (rtIsDue, rtIsDoneOn,
   rtDaySections, ...) directly rather than recomputing completion logic
   a second time, which is what would let the two surfaces drift apart.

   What is checked here:
     - an empty habit list prompts you to add one,
     - the card lists every habit due today, including weekly-target ones
       in their own row (mirroring the Routines tab's own grouping),
     - checking a box FROM OVERVIEW actually writes through to the real
       data model - the Routines tab reflects the same change,
     - the calendar is a collapsed drop-down on a narrow screen (closed by
       default, opens on tap, remembers open/closed across reloads) and a
       permanent right-hand column at >=768px, with the chevron/toggle
       affordance hidden there since there's nothing left to toggle,
     - week view shows 7 cells, month view shows a full month grid. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

async function run(viewport, label) {
  console.log(`\n=== ${label} ===`);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  check('the Routines hero card exists', await page.evaluate(() => !!document.querySelector('.ov-hero-routines')));
  const empty = await page.evaluate(() => document.getElementById('ovRoutinesList').textContent.trim());
  check('empty state prompts to add a habit', /No habits yet/.test(empty), empty);

  await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Read 20 minutes';
    rtSetCadence('daily');
    rtSaveHabit();
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Stretch';
    rtSetCadence('daily');
    rtSaveHabit();
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Practice guitar';
    rtSetCadence('week');
    rtSaveHabit();
    showAppView('overview');
  });
  await page.waitForTimeout(300);

  const rows = await page.evaluate(() => [...document.querySelectorAll('#ovRoutinesList .rt-item-row .rt-item-name')].map(n => n.textContent));
  check('lists every due habit, including the weekly one', rows.includes('Read 20 minutes') && rows.includes('Stretch') && rows.includes('Practice guitar'), JSON.stringify(rows));

  await page.evaluate(() => document.querySelector('#ovRoutinesList .rt-check').click());
  await page.waitForTimeout(200);
  check('checking a box from Overview marks it done', await page.evaluate(() => document.querySelectorAll('#ovRoutinesList .rt-check.done').length === 1));

  const rtTabReflects = await page.evaluate(() => {
    showAppView('routines');
    const done = document.querySelectorAll('#rtTodayList .rt-check.done').length;
    showAppView('overview');
    return done;
  });
  check('the check-off writes through to the real data model (Routines tab agrees)', rtTabReflects === 1, String(rtTabReflects));

  if (viewport.width < 768) {
    check('calendar starts collapsed on a narrow screen', await page.evaluate(() => !document.getElementById('ovRoutinesCalWrap').classList.contains('expanded')));
    await page.evaluate(() => document.querySelector('.ov-hero-routines .ov-hero-head').click());
    await page.waitForTimeout(150);
    check('tapping the header expands it', await page.evaluate(() => document.getElementById('ovRoutinesCalWrap').classList.contains('expanded')));
    check('week view shows 7 cells', await page.evaluate(() => document.querySelectorAll('#ovRoutinesCalGrid .rt-month-cell').length) === 7);

    await page.evaluate(() => setOvRoutinesCalMode('month'));
    await page.waitForTimeout(150);
    // Month mode uses a flat flow of small squares (.ov-month-flow/.ov-month-sq),
    // one per day of the month (no padding cells, no header/day numbers) - see
    // test_overview_routines_month_style.js for the detailed checks.
    const monthCells = await page.evaluate(() => document.querySelectorAll('#ovRoutinesCalGrid .ov-month-sq').length);
    check('month view shows a full month grid (>28 cells)', monthCells > 28, String(monthCells));

    await page.reload();
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    check('the open/closed state survives a reload', await page.evaluate(() => document.getElementById('ovRoutinesCalWrap').classList.contains('expanded')));
  } else {
    check('at wide layout the calendar is a permanent right column, not a toggle',
      await page.evaluate(() => getComputedStyle(document.getElementById('ovRoutinesCalWrap')).display !== 'none'));
    check('the chevron hides since there is nothing left to toggle',
      await page.evaluate(() => getComputedStyle(document.getElementById('ovRoutinesChevron')).display === 'none'));
    check('the calendar sits to the right of the habit list', await page.evaluate(() => {
      const main = document.querySelector('.ov-hero-routines .ov-hero-main').getBoundingClientRect();
      const cal = document.getElementById('ovRoutinesCalWrap').getBoundingClientRect();
      return cal.left >= main.right - 5;
    }));
  }

  check('no horizontal overflow', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)));
  await browser.close();
}

(async () => {
  await run({ width: 390, height: 950 }, 'Narrow (phone) - drop-down calendar');
  await run({ width: 900, height: 900 }, 'Wide (tablet/desktop) - side-by-side calendar');
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
