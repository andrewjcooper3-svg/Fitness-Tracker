/* The Pushups (and Water) habit link previously had no way to set a real
   trigger number - it silently defaulted to 100 reps/day with no UI
   control to change it. This adds a "Weekly total" field to the habit
   editor for threshold-linked habits: enter one weekly number and the
   daily trigger is that total divided across however many days the
   habit's cadence covers, recomputed live as the cadence changes rather
   than staying a flat number. Pushups defaults that weekly total to 990
   (the real weekly figure behind the 50k/year goal), replacing the old
   arbitrary 100/day default.

   What is checked here:
     - selecting the Pushups link on a new habit defaults its weekly
       total to 990, shown with a computed 141/day (990÷7, daily cadence),
     - switching to Specific days and picking 5 recomputes that preview
       live to 198/day (990÷5), with no page reload or re-select needed,
     - typing a different weekly total recomputes it again,
     - saving persists {source, weeklyTotal} - no leftover flat
       "threshold" key from the old model,
     - rtIsDoneOn actually enforces the computed number (197 not done,
       198 done, for 990÷5),
     - reopening a saved habit for edit prefills the weekly total it was
       actually saved with,
     - a pre-existing habit stored the old way (a flat h.link.threshold,
       no weeklyTotal) keeps behaving exactly as before until edited, and
       opening it for edit migrates the field to an equivalent weekly
       total (threshold × 7) rather than resetting to the new default. */
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
  await page.waitForTimeout(1200);

  console.log('=== New habit: selecting Pushups link defaults to a 990/week weekly total ===');
  await page.evaluate(() => { showAppView('routines'); rtOpenHabitSheet(); document.getElementById('rtHName').value = 'Pushups'; });
  await page.evaluate(() => { document.getElementById('rtHLink').value = 'pushups'; rtOnLinkChange(); });
  await page.waitForTimeout(100);
  let state = await page.evaluate(() => ({
    weeklyRowVisible: document.getElementById('rtLinkWeeklyRow').style.display !== 'none',
    weeklyInputValue: document.getElementById('rtHLinkWeekly').value,
    note: document.getElementById('rtLinkNote').textContent,
    draftLink: rtDraftLink
  }));
  check('the weekly-total row is shown', state.weeklyRowVisible, JSON.stringify(state));
  check('it defaults to 990', state.weeklyInputValue === '990' && state.draftLink.weeklyTotal === 990, JSON.stringify(state));
  check('with daily cadence (7 days), the note shows a 141/day trigger', /141/.test(state.note), state.note);

  console.log('\n=== Switching to Specific days (5 picked) recomputes the daily trigger live ===');
  await page.evaluate(() => {
    rtSetCadence('days');
    [1, 2, 3, 4, 5].forEach(d => rtToggleDay(d)); // Mon-Fri
  });
  await page.waitForTimeout(100);
  const afterDays = await page.evaluate(() => ({ note: document.getElementById('rtLinkNote').textContent, days: rtDraftDays.slice() }));
  check('picking 5 days updates the note to a 198/day trigger (990/5)', /198/.test(afterDays.note), JSON.stringify(afterDays));

  console.log('\n=== Typing a different weekly total recomputes the trigger too ===');
  await page.evaluate(() => { document.getElementById('rtHLinkWeekly').value = '700'; rtOnLinkWeeklyChange(); });
  await page.waitForTimeout(100);
  const afterEdit = await page.evaluate(() => document.getElementById('rtLinkNote').textContent);
  check('700/week over 5 days = 140/day', /140/.test(afterEdit), afterEdit);
  await page.evaluate(() => { document.getElementById('rtHLinkWeekly').value = '990'; rtOnLinkWeeklyChange(); }); // back to 990 for the save

  console.log('\n=== Saving persists {source, weeklyTotal}, no stale threshold key ===');
  await page.evaluate(() => rtSaveHabit());
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => RT_HABITS.list.find(h => h.name === 'Pushups'));
  check('saved with weeklyTotal 990 and no threshold key', saved && saved.link.weeklyTotal === 990 && saved.link.threshold === undefined, JSON.stringify(saved));
  check('cadence/days persisted as 5 specific days', saved.cadence === 'days' && saved.days.length === 5, JSON.stringify(saved));

  console.log('\n=== rtIsDoneOn actually uses the computed 198/day trigger ===');
  const doneCheck = await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Pushups');
    const k = dateKey(rtToday);
    localStorage.setItem(STORAGE_PUSHUP_LEDGER_KEY, JSON.stringify({ [k]: 197 }));
    const notDoneAt197 = rtIsDoneOn(h, k);
    localStorage.setItem(STORAGE_PUSHUP_LEDGER_KEY, JSON.stringify({ [k]: 198 }));
    const doneAt198 = rtIsDoneOn(h, k);
    return { notDoneAt197, doneAt198 };
  });
  check('197 reps is not done yet', doneCheck.notDoneAt197 === false, JSON.stringify(doneCheck));
  check('198 reps clears it (990/5)', doneCheck.doneAt198 === true, JSON.stringify(doneCheck));

  console.log('\n=== Re-opening for edit prefills the weekly total from what was saved ===');
  await page.evaluate(() => rtEditHabit(RT_HABITS.list.find(h => h.name === 'Pushups').id));
  await page.waitForTimeout(100);
  const reopened = await page.evaluate(() => ({
    weeklyInputValue: document.getElementById('rtHLinkWeekly').value,
    weeklyRowVisible: document.getElementById('rtLinkWeeklyRow').style.display !== 'none'
  }));
  check('re-opening shows 990 in the weekly total field', reopened.weeklyInputValue === '990', JSON.stringify(reopened));
  check('and the weekly row is visible', reopened.weeklyRowVisible, JSON.stringify(reopened));

  console.log('\n=== A legacy habit (flat threshold, no weeklyTotal) still works unchanged ===');
  const legacy = await page.evaluate(() => {
    rtCloseSheet();
    RT_HABITS.list.push({ id: 'legacy_water', name: 'LegacyWater', cadence: 'daily', created: null, link: { source: 'water', threshold: 100 } });
    rtHabitsChanged();
    const h = RT_HABITS.list.find(x => x.name === 'LegacyWater');
    const k = dateKey(rtToday);
    localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify({ [k]: 99 }));
    const notDone = rtIsDoneOn(h, k);
    localStorage.setItem('WORKOUT_WATER_LEDGER', JSON.stringify({ [k]: 100 }));
    const done = rtIsDoneOn(h, k);
    return { notDone, done };
  });
  check('legacy flat-threshold habit is unaffected (99 not done, 100 done)', legacy.notDone === false && legacy.done === true, JSON.stringify(legacy));

  console.log('\n=== Editing that legacy habit migrates it to a weeklyTotal (700 = 100 x 7 days) ===');
  await page.evaluate(() => rtEditHabit(RT_HABITS.list.find(h => h.name === 'LegacyWater').id));
  await page.waitForTimeout(100);
  const migrated = await page.evaluate(() => document.getElementById('rtHLinkWeekly').value);
  check('legacy water habit prefills weekly total as 700 (100/day x 7)', migrated === '700', migrated);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
