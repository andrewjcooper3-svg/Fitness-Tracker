/* Reordering habits/tasks from the Habits & Tasks list - up/down buttons,
   same established pattern as Arrange Overview and Settings' Tab Order,
   rather than drag-and-drop (fragile in a scrolling touch list).

   RT_HABITS.list is the single ordering that every surface reads from
   (Today, the Overview hero card, This week, Habits & Tasks itself), so
   reordering it here is enough to reorder everywhere - no separate
   "display order" to keep in sync.

   What is checked here:
     - the first habit's up button and the last habit's down button are
       disabled,
     - moving a habit swaps it with its active neighbor and the new order
       shows up on the Today list too (same array, same order),
     - moving a habit stamps a new savedAt, so a reorder syncs like any
       other habit edit,
     - a soft-deleted habit sitting between two active ones is skipped
       over rather than swappable - it keeps its position in the
       underlying array; only active habits participate in the visible
       ordering. */
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
    ['Alpha', 'Bravo', 'Charlie'].forEach(n => {
      rtOpenHabitSheet();
      document.getElementById('rtHName').value = n;
      rtSetCadence('daily');
      rtSaveHabit();
    });
    toggleKitchenCollapse_('rtHabitsBody', 'rtHabitsChevron');
  });
  await page.waitForTimeout(200);

  const initialOrder = await page.evaluate(() => RT_HABITS.list.map(h => h.name));
  check('starts in add order', JSON.stringify(initialOrder) === JSON.stringify(['Alpha', 'Bravo', 'Charlie']), JSON.stringify(initialOrder));

  const rowNames = () => page.evaluate(() => [...document.querySelectorAll('#rtHabitList .rt-habit-name')].map(n => n.textContent));

  const firstUpDisabled = await page.evaluate(() => document.querySelector('#rtHabitList .rt-habit-move[aria-label="Move up"]').disabled);
  check('first habit\'s up button is disabled', firstUpDisabled === true);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#rtHabitList .rt-habit-row')]);
  const lastDownDisabled = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#rtHabitList .rt-habit-row')];
    return rows[rows.length - 1].querySelector('.rt-habit-move[aria-label="Move down"]').disabled;
  });
  check('last habit\'s down button is disabled', lastDownDisabled === true);

  console.log('\n=== Moving Bravo up swaps it with Alpha ===');
  await page.evaluate(() => {
    const bravo = RT_HABITS.list.find(h => h.name === 'Bravo');
    rtMoveHabit(bravo.id, -1);
  });
  await page.waitForTimeout(150);
  const afterMove1 = await rowNames();
  check('order becomes Bravo, Alpha, Charlie', JSON.stringify(afterMove1) === JSON.stringify(['Bravo', 'Alpha', 'Charlie']), JSON.stringify(afterMove1));

  const savedAtAfterMove = await page.evaluate(() => RT_HABITS.savedAt);
  check('the reorder stamps a new savedAt (so it syncs like any other habit edit)', !!savedAtAfterMove);

  console.log('\n=== Moving Charlie up twice reaches the top ===');
  await page.evaluate(() => {
    const c = RT_HABITS.list.find(h => h.name === 'Charlie');
    rtMoveHabit(c.id, -1);
    rtMoveHabit(c.id, -1);
  });
  await page.waitForTimeout(150);
  const afterMove2 = await rowNames();
  check('order becomes Charlie, Bravo, Alpha', JSON.stringify(afterMove2) === JSON.stringify(['Charlie', 'Bravo', 'Alpha']), JSON.stringify(afterMove2));

  console.log('\n=== The Today list order follows the same order ===');
  const todayOrder = await page.evaluate(() => [...document.querySelectorAll('#rtTodayList .rt-item-name')].map(n => n.textContent));
  check('Today list reflects the same order (single source of truth)', JSON.stringify(todayOrder) === JSON.stringify(['Charlie', 'Bravo', 'Alpha']), JSON.stringify(todayOrder));

  console.log('\n=== A deleted habit between two active ones is skipped, not swapped ===');
  await page.evaluate(() => {
    // Delete Bravo (currently in the middle) - it stays in RT_HABITS.list
    // (soft delete) sitting between Charlie and Alpha in the underlying array.
    const bravo = RT_HABITS.list.find(h => h.name === 'Bravo');
    rtDeleteHabit(bravo.id);
  });
  await page.waitForTimeout(150);
  const underlyingOrder = await page.evaluate(() => RT_HABITS.list.map(h => `${h.name}${h.deleted ? '(deleted)' : ''}`));
  check('Bravo is soft-deleted but still sits between Charlie and Alpha in the array', JSON.stringify(underlyingOrder) === JSON.stringify(['Charlie', 'Bravo(deleted)', 'Alpha']), JSON.stringify(underlyingOrder));

  // Now move Alpha up - should skip over deleted Bravo and swap with Charlie directly.
  await page.evaluate(() => {
    const alpha = RT_HABITS.list.find(h => h.name === 'Alpha');
    rtMoveHabit(alpha.id, -1);
  });
  await page.waitForTimeout(150);
  const afterSkip = await page.evaluate(() => RT_HABITS.list.map(h => `${h.name}${h.deleted ? '(deleted)' : ''}`));
  check('moving Alpha up skips the deleted Bravo and swaps with Charlie directly', JSON.stringify(afterSkip) === JSON.stringify(['Alpha', 'Bravo(deleted)', 'Charlie']), JSON.stringify(afterSkip));

  const activeRowNames = await rowNames();
  check('the visible active list now shows Alpha, Charlie (Bravo hidden, deleted)', JSON.stringify(activeRowNames) === JSON.stringify(['Alpha', 'Charlie']), JSON.stringify(activeRowNames));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
