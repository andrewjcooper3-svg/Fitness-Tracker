/* Real bug report: a full session logged (weights, reps, checkmarks
   entered, "Generate Session Summary" clicked, confirmed logged to the
   Sheet) plus one custom exercise added via "+ Add Exercise" - refresh,
   and the ENTIRE day came back blank, not just the custom exercise.
   Confirmed it happened on both an iPhone home-screen icon and a desktop
   browser (ruling out any device-specific storage quirk), specific to
   whichever day had a custom exercise added (Wednesday), while a day
   with no custom addition (Tuesday) kept its data fine.

   Root cause: restoreDay's plan-changed guard (see
   test_exercise_reorder_persists.js for its history) compared the FULL
   saved exercise list - prescribed template exercises AND any custom
   "+ Add Exercise" ones - against WEEKLY_PLAN_DATA[day]. A custom
   exercise was never part of the template to begin with, so the moment
   one was added, the saved count permanently exceeded the template's
   count. Every later load read that mismatch as "the plan changed" and
   discarded restoration for the WHOLE day - prescribed exercises
   included, not just the custom one - forever, the same way the earlier
   reorder bug did, just triggered by an ordinary, fully-supported action
   instead of a drag.

   Fixed by comparing only the PRESCRIBED (custom: false) saved
   exercises against the template, ignoring custom ones entirely for
   this check - they were never expected to appear in
   WEEKLY_PLAN_DATA[day] regardless of anything else.

   What is checked here:
     - adding a custom exercise, then refreshing, does not wipe a
       prescribed exercise's already-typed weight,
     - the custom exercise itself survives the refresh too,
     - this holds on a SECOND refresh as well - not a one-time self-heal,
     - a genuine plan change (different template content, not just a
       custom addition) still correctly skips stale data - unaffected by
       this fix. */
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
  await page.evaluate(() => { showAppView('tracker'); showDay('wed'); });
  await page.waitForTimeout(300);

  console.log('=== Typing a real weight into a prescribed exercise, then adding a custom one ===');
  await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const inputs = document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input');
    inputs[0].value = '999';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#day-wed .add-exercise-btn').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const cards = document.querySelectorAll('#day-wed .exercise-card');
    const last = cards[cards.length - 1];
    const nameInput = last.querySelector('.exercise-name-input');
    nameInput.value = 'Farmer Carry';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);

  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE')).days.wed.exercises.map(e => e.name));
  check('the saved state carries all 15 (14 prescribed + 1 custom)', beforeReload.length === 15 && beforeReload.includes('Farmer Carry'), JSON.stringify(beforeReload));

  const reloadAndReadWed = async () => {
    await page.reload();
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { showAppView('tracker'); showDay('wed'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
    await page.waitForTimeout(150);
    return page.evaluate(() => ({
      legPressWeight: document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input')[0].value,
      names: [...document.querySelectorAll('#day-wed .exercise-card')].map(c => getExerciseName(c))
    }));
  };

  console.log('\n=== First refresh ===');
  const first = await reloadAndReadWed();
  check('the prescribed exercise\'s typed weight survives', first.legPressWeight === '999', first.legPressWeight);
  check('the custom exercise survives too, all 15 present', first.names.length === 15 && first.names.includes('Farmer Carry'), JSON.stringify(first.names));

  console.log('\n=== Second refresh (not a one-time self-heal) ===');
  const second = await reloadAndReadWed();
  check('still there on a second refresh', second.legPressWeight === '999' && second.names.includes('Farmer Carry'), JSON.stringify(second));

  console.log('\n=== A genuine plan change (different template content) still correctly skips stale data ===');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE') || '{"days":{}}');
    state.week = getWeekLabel();
    state.days.wed = { exercises: [{ id: 'ex0', custom: false, name: 'Some Old Exercise That No Longer Exists', sets: [{ weight: '1', reps: '1' }] }], checklist: {} };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(state));
  });
  const afterGenuineChange = await reloadAndReadWed();
  check('a truly stale plan still renders the fresh current template, not the old bogus exercise',
    afterGenuineChange.names.length === 14 && !afterGenuineChange.names.includes('Some Old Exercise That No Longer Exists'),
    JSON.stringify(afterGenuineChange.names));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
