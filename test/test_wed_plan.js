// Two independent things used to live in this file, both about
// WEEKLY_PLAN_DATA changing under someone's feet:
//
// 1) The Aug 24 Wednesday rewrite (RDL and Standing Calf Raise in, Machine
//    Chest Press and Hanging Knee Raise out) needed a one-time migration
//    (stripStaleWednesday20260824_) because ex0/ex1/... are assigned by DOM
//    position - a Wednesday saved against the old twelve-card template
//    would otherwise prune the new thirteen-card one down to whatever
//    lined up. That migration is hardcoded to 'wed' and its flag is
//    already set in real user data; it isn't going anywhere, so it's still
//    worth a smoke test that it does not corrupt whatever Wednesday's
//    CURRENT template happens to be.
//
// 2) The gym schedule itself later moved from Mon/Wed to Tue/Thu (this
//    file's original subject: Monday's and Wednesday's exercise lists).
//    That move needed no migration of its own - WORKOUT_TRACKER_STATE
//    resets to fresh at every week boundary (restoreState() compares
//    saved.week against getWeekLabel()), and the move landed exactly on
//    one such boundary, so there was never any stale per-day state to
//    reconcile against the new day assignment. This is just a content
//    check: Tuesday and Thursday now hold what Monday and Wednesday used
//    to.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve('/home/user/Fitness-Tracker/Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

  console.log('=== Tuesday and Thursday now hold the gym content Monday/Wednesday used to ===');
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const tue = await page.evaluate(() =>
    [...document.querySelectorAll('#day-tue .exercise-card .exercise-name')].map(e => e.textContent));
  const thu = await page.evaluate(() =>
    [...document.querySelectorAll('#day-thu .exercise-card .exercise-name')].map(e => e.textContent));
  const mon = await page.evaluate(() =>
    [...document.querySelectorAll('#day-mon .exercise-card .exercise-name')].map(e => e.textContent));
  const wed = await page.evaluate(() =>
    [...document.querySelectorAll('#day-wed .exercise-card .exercise-name')].map(e => e.textContent));

  console.log('  Tuesday:', tue.length, 'cards -', tue.join(', '));
  check('Tuesday is the old Monday gym day (12 cards)', tue.length === 12 && tue[0] === 'Leg Press'
    && tue.includes('Machine Chest Press') && tue.includes('Lateral Raise'), tue.join(', '));

  console.log('  Thursday:', thu.length, 'cards -', thu.join(', '));
  check('Thursday renders all 13 of the old Wednesday cards', thu.length === 13, String(thu.length));
  ['Leg Press', 'Dumbbell Romanian Deadlift', 'Leg Curl', 'Lat Pulldown',
   'CS DB Row (Left Arm Focus)', 'Inclined Dumbbell Chest Press', 'Face Pull',
   'Tricep Pulldown', 'Cable Bicep Curl', 'Standing Calf Raise', 'Cable Crunch',
   'Pushups', 'Walk'].forEach(n =>
    check(`  ${n} is there`, thu.includes(n)));
  check('Machine Chest Press is gone from Thursday', !thu.includes('Machine Chest Press'));
  check('Hanging Knee Raise is gone from Thursday', !thu.includes('Hanging Knee Raise'));

  console.log('  Monday:', mon.length, 'cards -', mon.join(', '));
  check('Monday is now a light bodyweight day, not the gym day', mon.length === 1 && mon[0] === 'Pushups', mon.join(', '));
  console.log('  Wednesday:', wed.length, 'cards -', wed.join(', '));
  check('Wednesday is now a light bodyweight day, not the gym day', wed.length === 1 && wed[0] === 'Pushups', wed.join(', '));

  const tabTypes = await page.evaluate(() => [...document.querySelectorAll('.day-tab .tab-type')].map(t => t.textContent));
  check('the day-tab badges read PU/Gym/PU/Gym for Mon-Thu',
    JSON.stringify(tabTypes.slice(0, 4)) === JSON.stringify(['PU', 'Gym', 'PU', 'Gym']), JSON.stringify(tabTypes));

  const groups = await page.evaluate(() => ['Dumbbell Romanian Deadlift', 'Standing Calf Raise', 'Face Pull']
    .map(n => n + ' -> ' + muscleFor_(n)));
  groups.forEach(g => console.log('  ', g));
  check('the moved exercises still classify correctly',
    groups[0].endsWith('Hamstrings') && groups[1].endsWith('Calves') && groups[2].endsWith('Shoulders'),
    groups.join(' | '));

  console.log('\n=== The Aug 24 Wednesday migration still safely clears stale Wednesday state ===');
  await page.evaluate(() => {
    // Pretend the 24th migration has not run yet, and lay down a saved
    // state shaped like the old (pre-Aug-24) twelve-card Wednesday - the
    // exact shape that migration exists to clear out. Wednesday's CURRENT
    // template is unrelated (now a 1-card Pushups day); the migration
    // should still wipe the stale array rather than try to merge it in.
    localStorage.removeItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260824');
    const state = JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE') || '{"days":{}}');
    state.days = state.days || {};
    state.days.wed = { exercises: Array.from({ length: 12 }, (_, i) => ({ id: 'ex' + i, sets: [] })), checklist: {} };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(state));
  });
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const wedAfterMigration = await page.evaluate(() =>
    [...document.querySelectorAll('#day-wed .exercise-card .exercise-name')].map(e => e.textContent));
  console.log('  Wednesday after migration:', wedAfterMigration.join(', '));
  check('the stale 12-card Wednesday is cleared, showing the current (Pushups-only) template cleanly',
    wedAfterMigration.length === 1 && wedAfterMigration[0] === 'Pushups', wedAfterMigration.join(', '));

  await ctx.close();
  await b.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
