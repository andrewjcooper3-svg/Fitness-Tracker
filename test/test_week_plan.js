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
       shows once in its own row rather than duplicated onto every day. */
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
  check('every day has a Pushups block', cols.every(c => c.pushups));
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

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
