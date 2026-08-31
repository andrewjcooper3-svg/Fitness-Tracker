/* The Calendar tab's new "Week Plan" sub-tab: a generated week-at-a-
   glance built from real calendar events (already fetched for the
   Upcoming list, reused here rather than a second network round-trip),
   fixed work/commute rules from Settings, and the workout plan's own
   "Est. time" text - not a live calendar of its own, and never writes
   anything back to Apple Calendar.

   What is checked here:
     - the sub-tab toggle shows/hides the right panel and doesn't
       infinitely recurse fetching calendar data (a real bug hit while
       building this - renderWeekPlan_ used to call ensureCalendarLoaded,
       whose "already loaded" branch re-renders the Overview preview,
       which now also re-enters renderWeekPlan_),
     - a light (non-lift) day gets a work block but no workout block,
       a lift day gets both, and every day gets a Pushups block,
     - a real calendar event renders as a blocking block by default,
     - marking that event's calendar "informational" in Settings turns
       it into a thin marker instead, live, without a reload,
     - short back-to-back blocks (a 5-10 min commute) never visually
       overlap the block right after them - a real bug hit while
       building this, where a "minimum visible height" taller than a
       short block's own real time slot forced it into the next one,
     - due habits/tasks show under each day, and a weekly-target one
       shows once in its own row rather than duplicated onto every day,
     - two items sharing the same time split into side-by-side columns
       instead of stacking on top of each other,
     - the grid is one continuous scrollable column (not a set of zoom
       presets to switch between), the axis stays aligned with the grid's
       hour lines, and today's column carries a live "now" line,
     - a habit with no completion history yet falls back to a plain
       due-chip; once it has enough history, it places itself on the
       grid at its own learned average time instead,
     - sourdough starter feeds show on the grid: a real logged feed on the
       day it happened, and a projected next feed (dashed) derived from
       the starter's own learned interval. */
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

  const workerUrl = 'https://weekplan-test.example.com';
  await page.route(workerUrl + '/**', r => {
    const now = new Date();
    const monday = new Date(now); const dow = monday.getDay();
    monday.setDate(monday.getDate() + ((dow === 0 ? -6 : 1) - dow));
    const tue = new Date(monday); tue.setDate(monday.getDate() + 1); tue.setHours(11, 0, 0, 0);
    const tueEnd = new Date(tue); tueEnd.setHours(12, 0, 0, 0);
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success', events: [
          { start: tue.toISOString(), end: tueEnd.toISOString(), summary: 'Dentist', calendar: 'Work', color: '#4F82AA', allDay: false }
        ]
      })
    });
  });

  // Overview's own "Upcoming" preview eagerly calls ensureCalendarLoaded()
  // at boot, which would otherwise fire against the default worker URL
  // before this test gets a chance to point it at the mocked one - set it
  // and reload so boot picks it up from the start, same pattern other
  // tests here use for a URL that needs to be in place before boot fires.
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.evaluate((url) => localStorage.setItem('WORKOUT_CALENDAR_WORKER_URL', url), workerUrl);
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => showAppView('calendar'));
  await page.waitForTimeout(300);
  check('Upcoming sub-tab is active by default', await page.evaluate(() => document.querySelector('#calSubSeg button.active').dataset.sub === 'upcoming'));

  await page.evaluate(() => setCalSubTab('weekplan'));
  await page.waitForTimeout(600);
  check('Week Plan sub-tab is now active', await page.evaluate(() => document.querySelector('#calSubSeg button.active').dataset.sub === 'weekplan'));
  check('the Upcoming panel is hidden', await page.evaluate(() => document.getElementById('calSubUpcoming').style.display === 'none'));
  check('no page errors (no infinite-recursion regression)', errors.length === 0, errors.join(' | '));

  const cols = await page.evaluate(() => [...document.querySelectorAll('#wpGrid .wp-day-col-wrap')].map(c => ({
    day: c.querySelector('.wp-day-head').textContent,
    work: !!c.querySelector('.wp-block-work'),
    workout: !!c.querySelector('.wp-block-workout'),
    pushups: !!c.querySelector('.wp-block-pushups'),
    event: !!c.querySelector('.wp-block-event'),
    marker: !!c.querySelector('.wp-marker')
  })));
  check('7 day columns rendered', cols.length === 7, String(cols.length));
  check('Monday (light day) has work but no workout block', cols[0].work && !cols[0].workout, JSON.stringify(cols[0]));
  check('Tuesday (gym day) has both a work block and a workout block', cols[1].work && cols[1].workout, JSON.stringify(cols[1]));
  // Pushups now places on the 6 weekdays with the most pushup-ledger
  // history (wpPushupActiveDows_) rather than blindly every day - this
  // app's boot sequence unconditionally seeds some real historical ledger
  // dates, so exactly which day comes up short depends on that data, not
  // a fixed assumption; just check the count comes out to 6 of 7.
  const pushupDayCount = cols.filter(c => c.pushups).length;
  check('exactly 6 of 7 days have a Pushups block (the 6 most active weekdays)', pushupDayCount === 6, JSON.stringify(cols.map(c => c.pushups)));
  check('the real "Dentist" event shows as a blocking block by default', cols[1].event && !cols[1].marker, JSON.stringify(cols[1]));

  console.log('\n=== Marking the Work calendar informational flips it to a marker, live ===');
  await page.evaluate(() => { openSettingsModal(); toggleWeekPlanConfig(); });
  await page.waitForTimeout(200);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#wpCalendarList .wp-cal-row')].map(r => r.textContent));
  check('the calendar list shows the Work calendar', rows.some(r => /Work/.test(r)), JSON.stringify(rows));

  await page.evaluate(() => document.querySelector('#wpCalendarList .wp-cal-toggle-btn').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => closeSettingsModal());
  await page.waitForTimeout(200);

  const afterToggle = await page.evaluate(() => {
    const tueCol = [...document.querySelectorAll('#wpGrid .wp-day-col-wrap')][1];
    return { event: !!tueCol.querySelector('.wp-block-event'), marker: !!tueCol.querySelector('.wp-marker') };
  });
  check('after marking it informational, the event is a marker instead of a blocking block', afterToggle.marker && !afterToggle.event, JSON.stringify(afterToggle));

  console.log('\n=== Short back-to-back blocks (commutes) never overlap ===');
  const tueBlocks = await page.evaluate(() => {
    const col = [...document.querySelectorAll('#wpGrid .wp-day-col')][1];
    return [...col.querySelectorAll('.wp-block')].map(b => {
      const r = b.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }).sort((a, b) => a.top - b.top);
  });
  let overlap = false;
  for (let i = 1; i < tueBlocks.length; i++) {
    if (tueBlocks[i].top < tueBlocks[i - 1].bottom - 0.5) overlap = true;
  }
  check('no two stacked blocks on Tuesday visually overlap', !overlap, JSON.stringify(tueBlocks));

  console.log('\n=== Habits/tasks are listed ===');
  await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Read';
    rtSetCadence('daily');
    rtSaveHabit();
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Guitar';
    rtSetCadence('week');
    rtSaveHabit();
    showAppView('calendar');
  });
  await page.waitForTimeout(300);
  const habitsInfo = await page.evaluate(() => ({
    mondayText: [...document.querySelectorAll('#wpGrid .wp-day-col-wrap')][0].querySelector('.wp-day-habits').textContent,
    weeklyRowText: document.getElementById('wpWeeklyRow').textContent
  }));
  check('the daily habit "Read" shows under Monday', /Read/.test(habitsInfo.mondayText), habitsInfo.mondayText);
  check('the weekly habit "Guitar" is NOT duplicated onto Monday', !/Guitar/.test(habitsInfo.mondayText), habitsInfo.mondayText);
  check('"Guitar" shows once in the weekly-target row with a fraction', /Guitar/.test(habitsInfo.weeklyRowText) && /\d\/\d/.test(habitsInfo.weeklyRowText), habitsInfo.weeklyRowText);

  console.log('\n=== Week navigation ===');
  const label1 = await page.evaluate(() => document.getElementById('wpWeekLabel').textContent);
  await page.evaluate(() => wpWeekNext());
  await page.waitForTimeout(150);
  const label2 = await page.evaluate(() => document.getElementById('wpWeekLabel').textContent);
  check('next-week navigation changes the displayed week', label1 !== label2, `${label1} -> ${label2}`);
  await page.evaluate(() => wpWeekPrev());
  await page.waitForTimeout(150);

  console.log('\n=== Same-time items lay out side by side, not stacked ===');
  const columnLayout = await page.evaluate(() => {
    const overlapping = wpLayoutColumns_([
      { start: 600, end: 660, cls: 'a', label: 'A' },
      { start: 600, end: 660, cls: 'b', label: 'B' }
    ]).map(it => ({ col: it.col, totalCols: it.totalCols }));
    const separate = wpLayoutColumns_([
      { start: 600, end: 660, cls: 'a', label: 'A' },
      { start: 700, end: 760, cls: 'b', label: 'B' }
    ]).map(it => it.totalCols);
    return { overlapping, separate };
  });
  check('two fully-overlapping items get 2 columns in different slots',
    columnLayout.overlapping.length === 2 && columnLayout.overlapping[0].totalCols === 2 &&
    columnLayout.overlapping[1].totalCols === 2 && columnLayout.overlapping[0].col !== columnLayout.overlapping[1].col,
    JSON.stringify(columnLayout.overlapping));
  check('two items that never overlap each stay full-width (1 column)',
    columnLayout.separate.every(c => c === 1), JSON.stringify(columnLayout.separate));

  console.log('\n=== One continuous scrollable column, not zoom presets ===');
  const scrollShape = await page.evaluate(() => {
    const wrap = document.getElementById('wpGridWrap');
    const grid = document.getElementById('wpGrid');
    const axisHours = document.querySelectorAll('#wpGrid .wp-axis-hour').length;
    return { scrollable: wrap.scrollHeight > wrap.clientHeight, axisHours, scrollTop: wrap.scrollTop };
  });
  check('the grid-wrap actually overflows (a real scroll area, not a fixed page)', scrollShape.scrollable, JSON.stringify(scrollShape));
  check('all 24 hours are in the DOM at once (one continuous column)', scrollShape.axisHours === 24, String(scrollShape.axisHours));
  check('opening the tab auto-scrolled away from midnight', scrollShape.scrollTop > 0, String(scrollShape.scrollTop));

  const alignment = await page.evaluate(() => {
    const grid = document.getElementById('wpGrid');
    const gridTop = grid.getBoundingClientRect().top;
    // .wp-axis-hour carries a deliberate -6px nudge (CSS) so the printed
    // number sits up next to the line it labels rather than centered in
    // its own row - a constant per label, so it's undone here rather than
    // treated as slop. What actually matters is that this offset STAYS
    // constant across labels: if the axis's own row height doesn't match
    // the grid's px/hour, the gap between axis and grid grows with every
    // row instead of holding steady.
    const axisHours = [...document.querySelectorAll('#wpGrid .wp-axis-hour')];
    const hourLines = [...document.querySelector('#wpGrid .wp-day-col').querySelectorAll('.wp-hour-line')];
    // hourLines start one hour later than axisHours (there's no line at
    // the very top edge, just the first label) - hourLines[i] lines up
    // with axisHours[i + 1].
    const nudge = 6;
    const diffAt = i => Math.abs((axisHours[i + 1].getBoundingClientRect().top - gridTop + nudge) - (hourLines[i].getBoundingClientRect().top - gridTop));
    return { early: diffAt(0), late: diffAt(hourLines.length - 1) };
  });
  check('the axis stays aligned with the day columns\' hour lines near the top', alignment.early < 2, JSON.stringify(alignment));
  check('...and stays aligned deep into the column too (no cumulative drift from a mismatched row height)', alignment.late < 2, JSON.stringify(alignment));

  const nowLine = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#wpGrid .wp-day-col-wrap')];
    const todayIdx = cols.findIndex(c => c.querySelector('.wp-day-head.today'));
    return { todayIdx, nowLines: cols.map(c => !!c.querySelector('.wp-now-line')) };
  });
  check('a "now" line is drawn only on today\'s column', nowLine.todayIdx >= 0 &&
    nowLine.nowLines.filter(Boolean).length === 1 && nowLine.nowLines[nowLine.todayIdx],
    JSON.stringify(nowLine));

  await page.evaluate(() => { document.getElementById('wpGridWrap').scrollTop = 0; });
  await page.evaluate(() => wpWeekToday());
  await page.waitForTimeout(150);
  const rescrolled = await page.evaluate(() => document.getElementById('wpGridWrap').scrollTop);
  check('the Today button re-scrolls back near "now"', rescrolled > 0, String(rescrolled));

  console.log('\n=== A habit with enough history places itself on the grid ===');
  await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Make Bed';
    rtSetCadence('daily');
    rtSaveHabit();
    showAppView('calendar');
  });
  await page.waitForTimeout(300);
  const noHistory = await page.evaluate(() => {
    const mon = [...document.querySelectorAll('#wpGrid .wp-day-col-wrap')][0];
    return { hasBlock: !!mon.querySelector('.wp-block-habit'), chipText: mon.querySelector('.wp-day-habits').textContent };
  });
  check('with no completion history yet, it falls back to a plain due-chip',
    !noHistory.hasBlock && /Make Bed/.test(noHistory.chipText), JSON.stringify(noHistory));

  await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Make Bed');
    const monday = getWeekMondayFor(new Date());
    for (let i = 1; i <= 5; i++) {
      const d = new Date(monday.getTime() - i * ROUTINES_DAY_MS);
      const loggedAt = new Date(d); loggedAt.setHours(7, 15, 0, 0);
      RT_LOG[dateKey(d)] = RT_LOG[dateKey(d)] || {};
      RT_LOG[dateKey(d)][h.id] = { done: true, loggedAt: loggedAt.toISOString() };
    }
    rtSaveLogLocal();
    renderWeekPlan_();
  });
  await page.waitForTimeout(300);
  const withHistory = await page.evaluate(() => {
    const mon = [...document.querySelectorAll('#wpGrid .wp-day-col-wrap')][0];
    return { hasBlock: !!mon.querySelector('.wp-block-habit'), chipText: mon.querySelector('.wp-day-habits').textContent };
  });
  check('with 5 days of ~7:15am history, it now places on the grid at that learned time',
    withHistory.hasBlock, JSON.stringify(withHistory));
  check('and it no longer duplicates onto the plain chip list',
    !/Make Bed/.test(withHistory.chipText), JSON.stringify(withHistory));

  console.log('\n=== Sourdough starter feeds show on the grid ===');
  await page.evaluate(() => {
    const fedAt = new Date(); fedAt.setHours(8, 0, 0, 0);
    const st = {
      stage: 'active', name: 'Test', bornOn: null, build: {}, location: 'counter',
      ratio: '1:1:1', flour: 'bread', keepG: 100, tempF: 70,
      feeds: [{ id: 'f1', at: fedAt.toISOString(), keepG: 100, ratio: '1:1:1', flour: 'bread', tempF: 70, location: 'counter', checks: [] }]
    };
    localStorage.setItem('WORKOUT_KITCHEN_STARTER', JSON.stringify(st));
    renderWeekPlan_();
  });
  await page.waitForTimeout(300);
  const starterBlocks = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#wpGrid .wp-day-col-wrap')];
    return {
      real: cols.map(c => !!c.querySelector('.wp-block-starter:not(.projected)')),
      projected: cols.some(c => !!c.querySelector('.wp-block-starter.projected'))
    };
  });
  check('a real logged feed shows a solid starter block on the day it happened',
    starterBlocks.real.some(Boolean), JSON.stringify(starterBlocks.real));
  check('a projected next feed shows somewhere in the week as a dashed block',
    starterBlocks.projected, JSON.stringify(starterBlocks));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
