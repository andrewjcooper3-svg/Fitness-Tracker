/* Real bug report: "my inputs on Wednesday workouts are getting wiped on
   refresh." Root cause was restoreDay's plan-change guard (added earlier
   to stop a genuinely stale saved plan from corrupting a freshly changed
   one - see test_plan_change_state_restore.js) comparing saved exercise
   names to the current plan POSITION BY POSITION. Reordering an exercise
   via the drag handle is a real, supported feature - the exact same
   exercises, just in a different order - but a positional comparison
   read that as "the plan changed" and permanently skipped restoring
   sets/weights/checkmarks for that day from then on: every subsequent
   save wrote the reordered (correct) names, every subsequent load still
   compared them position-by-position against the plan's original order,
   found a mismatch, and discarded them again. Not a one-time glitch -
   the day was stuck silently discarding input forever once reordered.

   Fixed by comparing the saved and current exercise names as a SET
   (sorted) rather than a strict sequence: only an actual difference in
   WHICH exercises exist should skip restoration; a mere reorder should
   not.

   What is checked here:
     - reordering two exercise cards, then saving, does NOT trip the
       plan-changed guard,
     - a value typed into the moved card survives a reload,
     - the reordered position itself survives the reload too (not just
       reverting to the plan's original order),
     - a genuine plan change (different exercise content entirely, not
       just reordered) still correctly skips stale restoration - the
       protection this guard exists for is not weakened. */
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

  console.log('=== Reordering two exercise cards, then typing a value and saving ===');
  await page.evaluate(() => {
    const panel = document.getElementById('day-wed');
    const cards = [...panel.querySelectorAll('.exercise-card')];
    panel.insertBefore(cards[1], cards[0]); // swap the first two cards, like a drag would
  });
  await page.waitForTimeout(150);
  const reorderedNames = await page.evaluate(() =>
    [...document.querySelectorAll('#day-wed .exercise-card .exercise-name')].map(e => e.textContent));
  check('the DOM now shows the swapped order', reorderedNames[0] === 'Leg Extension' && reorderedNames[1] === 'Leg Press', JSON.stringify(reorderedNames.slice(0, 2)));

  await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const inputs = document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input');
    inputs[0].value = '777';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => saveState());
  await page.waitForTimeout(200);

  console.log('\n=== Reload: the reorder and the typed value both survive ===');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('tracker'); showDay('wed'); });
  await page.waitForTimeout(300);

  const afterReloadNames = await page.evaluate(() =>
    [...document.querySelectorAll('#day-wed .exercise-card .exercise-name')].map(e => e.textContent));
  check('the reordered position itself survives the reload', afterReloadNames[0] === 'Leg Extension' && afterReloadNames[1] === 'Leg Press', JSON.stringify(afterReloadNames.slice(0, 2)));

  await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
  await page.waitForTimeout(150);
  const value = await page.evaluate(() => document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input')[0].value);
  check('the typed value survives the reload - not wiped', value === '777', value);

  console.log('\n=== Reload again (a second refresh) - still not wiped, not a one-time fluke ===');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('tracker'); showDay('wed'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
  await page.waitForTimeout(150);
  const valueAgain = await page.evaluate(() => document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input')[0].value);
  check('still there on a second refresh (permanently fixed, not a one-time self-heal)', valueAgain === '777', valueAgain);

  console.log('\n=== A genuine plan change (different exercise content) still correctly skips stale data ===');
  const genuineChange = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE') || '{"days":{}}');
    state.week = getWeekLabel();
    state.days.wed = {
      exercises: [
        { id: 'ex0', name: 'Some Old Exercise That No Longer Exists', sets: [{ weight: '1', reps: '1' }] }
      ],
      checklist: {}
    };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(state));
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('tracker'); showDay('wed'); });
  await page.waitForTimeout(300);
  const afterGenuineChange = await page.evaluate(() =>
    [...document.querySelectorAll('#day-wed .exercise-card .exercise-name')].map(e => e.textContent));
  check('a truly stale/different plan still renders the fresh current template, not the old bogus exercise',
    afterGenuineChange.length === 14 && !afterGenuineChange.includes('Some Old Exercise That No Longer Exists'),
    JSON.stringify(afterGenuineChange));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
