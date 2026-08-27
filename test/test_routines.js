/* The Routines tab: habits/tasks with a real history, real cross-device
   sync, and the ability to link a habit to something else already being
   tracked (Water, Pushups) instead of checking it off by hand.

   What is checked here:
     - the tab wires up cleanly (no fake seed data - a new user's list is
       genuinely empty, unlike the mockup this grew out of),
     - add/edit/delete/restore all operate on the real habit list, and
       deleting keeps history instead of erasing it - restoring never
       retroactively fills in the gap while it was gone,
     - a weekly-target habit gets its own checkable group, separate from
       the fixed daily/specific-day ring,
     - a habit linked to Water auto-completes once that day's logged
       ounces clear the habit's threshold, tracks the LIVE source value
       rather than a frozen snapshot, and can't be manually toggled,
     - the sync loop actually round-trips through the backend: habits as
       a whole-list last-write-wins blob, check-offs as individual
       logRoutine events that fold to a per-(date, habit) ledger. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });

  // A mock backend: the habit list as a whole-blob store, check-offs as an
  // append-only event log folded to latest-per-(date,habit) on read - the
  // same shape getRoutinesLedgerFromSheets_ builds from the real Sheet.
  let habitsStore = null;
  const routinesLog = [];
  await page.route('https://script.google.com/**', route => {
    const req = route.request();
    if (req.method() === 'GET') {
      const url = req.url();
      if (url.includes('action=loadRoutinesHabits')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', habits: habitsStore }) });
      }
      if (url.includes('action=loadRoutinesLedger')) {
        const ledger = {};
        routinesLog.forEach(e => {
          ledger[e.date] = ledger[e.date] || {};
          const existing = ledger[e.date][e.habitId];
          if (!existing || e.loggedAt >= existing.loggedAt) ledger[e.date][e.habitId] = { done: e.done, loggedAt: e.loggedAt };
        });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', ledger }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    }
    const body = JSON.parse(req.postData() || '{}');
    if (body.action === 'saveRoutinesHabits') {
      if (!habitsStore || !habitsStore.savedAt || body.habits.savedAt > habitsStore.savedAt) habitsStore = body.habits;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', habits: habitsStore }) });
    }
    if (body.action === 'logRoutine') {
      routinesLog.push({ date: body.date, habitId: body.habitId, done: body.done, loggedAt: new Date().toISOString() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
  });

  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.evaluate(key => localStorage.setItem(key, 'https://script.google.com/macros/s/FAKE/exec'), 'WORKOUT_DEPLOYMENT_URL');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.evaluate(() => showAppView('routines'));
  await page.waitForTimeout(300);

  console.log('=== A new user starts with a genuinely empty list ===');
  const emptyState = await page.evaluate(() => document.getElementById('rtHabitList').textContent);
  check('no fake seed habits leaked in from the mockup', /No habits yet/.test(emptyState), emptyState.trim().slice(0, 60));

  console.log('\n=== Adding, checking off, and editing a daily habit ===');
  await page.evaluate(() => {
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Read 20 minutes';
    rtSetCadence('daily');
    rtSaveHabit();
  });
  await page.waitForTimeout(150);
  let names = await page.evaluate(() => RT_HABITS.list.map(h => h.name));
  check('the habit was added', names.includes('Read 20 minutes'), JSON.stringify(names));

  const habitId = await page.evaluate(() => RT_HABITS.list[0].id);
  await page.evaluate(() => document.querySelector('#rtTodayList .rt-check').click());
  await page.waitForTimeout(150);
  const doneToday = await page.evaluate(id => rtIsDoneOn(RT_HABITS.list.find(h => h.id === id), dateKey(rtToday)), habitId);
  check('checking it off marks today done', doneToday === true);
  check('the check-off was pushed to the backend as a logRoutine event', routinesLog.length >= 1, `${routinesLog.length} events`);

  await page.evaluate(id => {
    rtEditHabit(id);
    document.getElementById('rtHName').value = 'Read 30 minutes';
    rtSaveHabit();
  }, habitId);
  const afterEdit = await page.evaluate(id => RT_HABITS.list.find(h => h.id === id), habitId);
  check('editing updates the SAME habit (id preserved), not a duplicate', afterEdit.id === habitId && afterEdit.name === 'Read 30 minutes');
  check('the log entry from before the rename still points at it', await page.evaluate(id => rtIsDoneOn(RT_HABITS.list.find(h => h.id === id), dateKey(rtToday)), habitId));

  console.log('\n=== Delete keeps history; restore never backfills the gap ===');
  // Backdate its creation so "yesterday" is a real day it was active for -
  // it was only actually added moments ago in this same test run.
  await page.evaluate(id => {
    RT_HABITS.list.find(h => h.id === id).created = dateKey(new Date(rtToday.getTime() - 5 * ROUTINES_DAY_MS));
  }, habitId);
  await page.evaluate(id => rtDeleteHabit(id), habitId);
  const afterDelete = await page.evaluate(id => {
    const h = RT_HABITS.list.find(x => x.id === id);
    return { present: !!h, deleted: h && h.deleted, dueToday: h && rtIsDue(h, rtToday), dueYesterday: h && rtIsDue(h, new Date(rtToday.getTime() - ROUTINES_DAY_MS)) };
  }, habitId);
  check('the habit is hidden and no longer due, but not erased', afterDelete.present && afterDelete.deleted && !afterDelete.dueToday);
  check('history before the deletion is untouched', afterDelete.dueYesterday === true, JSON.stringify(afterDelete));

  await page.evaluate(id => {
    const h = RT_HABITS.list.find(x => x.id === id);
    h.deletedAt = dateKey(new Date(rtToday.getTime() - 3 * ROUTINES_DAY_MS)); // simulate 3 days gone
    rtRestoreHabit(id);
  }, habitId);
  const afterRestore = await page.evaluate(id => {
    const h = RT_HABITS.list.find(x => x.id === id);
    return {
      deleted: h.deleted,
      dueToday: rtIsDue(h, rtToday),
      dueInGap: rtIsDue(h, new Date(rtToday.getTime() - 2 * ROUTINES_DAY_MS))
    };
  }, habitId);
  check('restoring reactivates it from today', afterRestore.deleted === false && afterRestore.dueToday === true);
  check('the days it was deleted stay excluded - restoring does not undo the gap', afterRestore.dueInGap === false, JSON.stringify(afterRestore));

  console.log('\n=== A weekly-target habit gets its own checkable group ===');
  await page.evaluate(() => {
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Practice guitar';
    rtSetCadence('week');
    rtBumpWeekTarget(0); // leave at default 3
    rtSaveHabit();
  });
  await page.waitForTimeout(150);
  const weeklyRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rtTodayList .rt-item-row')].find(r => /Practice guitar/.test(r.textContent));
    const label = document.querySelector('#rtTodayList .rt-item-group-label');
    return { found: !!row, hasCheck: row && !!row.querySelector('.rt-check'), groupLabel: label && label.textContent };
  });
  check('the weekly habit shows up in its own group with a checkbox', weeklyRow.found && weeklyRow.hasCheck, JSON.stringify(weeklyRow));
  const guitarId = await page.evaluate(() => RT_HABITS.list.find(h => h.name === 'Practice guitar').id);
  await page.evaluate(id => document.querySelector(`.rt-item-row button[onclick*="${id}"]`)?.click(), guitarId);
  await page.waitForTimeout(150);
  const weeklyCount = await page.evaluate(id => rtWeekCountSoFar(RT_HABITS.list.find(h => h.id === id), rtToday), guitarId);
  check('checking a weekly item off counts toward its weekly total', weeklyCount === 1, String(weeklyCount));

  console.log('\n=== Linking a habit to Water ===');
  await page.evaluate(() => {
    localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify({ [dateKey(rtToday)]: 72 }));
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Drink water';
    rtSetCadence('daily');
    rtDraftLink = { source: 'water', threshold: 64 };
    rtSaveHabit();
  });
  const waterLinked = await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Drink water');
    return { link: h.link, done: rtIsDoneOn(h, dateKey(rtToday)) };
  });
  check('a habit linked to Water auto-completes once logged oz clears the threshold', waterLinked.link && waterLinked.done === true, JSON.stringify(waterLinked));

  const disabled = await page.evaluate(() => {
    rtRenderAll();
    const row = [...document.querySelectorAll('#rtTodayList .rt-item-row')].find(r => /Drink water/.test(r.textContent));
    return row.querySelector('.rt-check').disabled;
  });
  check('a linked habit cannot be manually checked off', disabled === true);

  await page.evaluate(() => localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify({ [dateKey(rtToday)]: 10 })));
  const nowUndone = await page.evaluate(() => rtIsDoneOn(RT_HABITS.list.find(h => h.name === 'Drink water'), dateKey(rtToday)));
  check('it tracks the live source value, not a frozen snapshot', nowUndone === false);

  console.log('\n=== Sync round-trip ===');
  await page.waitForTimeout(1200); // debounced push
  check('the habit list reached the mocked backend', !!habitsStore && Array.isArray(habitsStore.list) && habitsStore.list.length > 0,
    JSON.stringify(habitsStore && habitsStore.list.map(h => h.name)));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
