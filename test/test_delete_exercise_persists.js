/* Real bug report, the mirror image of test_custom_exercise_persists.js:
   "I deleted a workout. didn't create one." Deleting a prescribed
   exercise (the trash/delete action on an exercise card, confirm()'d)
   also permanently wiped the whole day on every later refresh - same
   failure mode as adding a custom one, just the count moving the other
   direction.

   By the time this was found, restoreDay's plan-changed guard had
   already been patched twice today for two other legitimate actions
   (reordering via drag, adding a custom exercise) that each broke it a
   different way - both patches kept the same underlying assumption (an
   exact match, by length and/or full set, between saved and template
   names) and each new legitimate user action found a new way to violate
   it. This is why the real fix (in restoreDay itself, see its comment)
   moved to a SUBSET check instead: "the plan changed" means a saved
   prescribed exercise name doesn't exist ANYWHERE in the current
   template, not that the saved list's shape doesn't match it exactly.
   Deleting a prescribed exercise makes the saved list a smaller, still
   entirely valid subset - not evidence of anything stale.

   What is checked here:
     - deleting a prescribed exercise, then refreshing, keeps the
       deletion (it doesn't silently come back) AND keeps a typed weight
       on a different, undeleted exercise - not a full-day wipe,
     - this holds on a second refresh too,
     - a genuine plan change (a saved name that doesn't exist in the
       current template at all) still correctly skips stale data. */
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
  page.on('dialog', d => d.accept()); // deleteExercise's confirm()
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('tracker'); showDay('wed'); });
  await page.waitForTimeout(300);

  console.log('=== Typing a weight into Leg Press, then deleting Plank (a prescribed exercise) ===');
  await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const inputs = document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input');
    inputs[0].value = '999';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const plank = [...document.querySelectorAll('#day-wed .exercise-card')].find(c => getExerciseName(c) === 'Plank');
    deleteExercise(plank);
  });
  await page.waitForTimeout(200);

  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE')).days.wed.exercises.map(e => e.name));
  check('Plank is gone from the saved state, the other 13 remain', beforeReload.length === 13 && !beforeReload.includes('Plank'), JSON.stringify(beforeReload));

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
  check('Plank stays deleted (does not silently come back)', !first.names.includes('Plank') && first.names.length === 13, JSON.stringify(first.names));
  check('Leg Press\'s typed weight survives - not a full-day wipe', first.legPressWeight === '999', first.legPressWeight);

  console.log('\n=== Second refresh (not a one-time self-heal) ===');
  const second = await reloadAndReadWed();
  check('still holds on a second refresh', !second.names.includes('Plank') && second.legPressWeight === '999', JSON.stringify(second));

  console.log('\n=== A genuine plan change (a saved name absent from the current template) still correctly skips stale data ===');
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
