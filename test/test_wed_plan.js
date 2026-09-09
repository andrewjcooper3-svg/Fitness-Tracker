// Two independent things live in this file, both about WEEKLY_PLAN_DATA
// changing under someone's feet:
//
// 1) The Aug 24 Wednesday rewrite (RDL and Standing Calf Raise in, Machine
//    Chest Press and Hanging Knee Raise out) needed a one-time migration
//    (stripStaleWednesday20260824_) because ex0/ex1/... are assigned by DOM
//    position - a Wednesday saved against the old twelve-card template
//    would otherwise prune the new thirteen-card one down to whatever
//    lined up. That migration is hardcoded to 'wed' and its flag is
//    already set in real user data; it isn't going anywhere, so it's still
//    worth a smoke test that it does not corrupt whatever Wednesday's
//    CURRENT template happens to be - regardless of how many times the
//    schedule has moved since (Mon/Wed -> Tue/Thu -> Wed/Fri, each of
//    those later moves handled by their own migration, or - for the most
//    recent Wed/Fri move - by restoreDay's generic saved-name-vs-current-
//    plan comparison guard instead of a new one-time migration).
//
// 2) The gym schedule itself has moved twice more since this file's
//    original subject (Mon/Wed, this file's namesake). This is now just a
//    content check against the CURRENT rotation: Monday/Sunday rest,
//    Tuesday/Thursday a single Pushups card, Wednesday/Friday the full
//    gym sessions, Saturday a short Pushups/Walk/Sauna day.
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

  console.log('=== The current rotation: Mon/Sun rest, Tue/Thu Pushups-only, Wed/Fri gym, Sat light ===');
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const cardsFor = async (day) => page.evaluate((d) =>
    [...document.querySelectorAll(`#day-${d} .exercise-card .exercise-name`)].map(e => e.textContent), day);
  const mon = await cardsFor('mon');
  const tue = await cardsFor('tue');
  const wed = await cardsFor('wed');
  const thu = await cardsFor('thu');
  const fri = await cardsFor('fri');
  const sat = await cardsFor('sat');
  const sun = await cardsFor('sun');

  console.log('  Monday:', mon.length, 'cards -', mon.join(', '));
  check('Monday is a rest day (no cards)', mon.length === 0, mon.join(', '));

  console.log('  Tuesday:', tue.length, 'cards -', tue.join(', '));
  check('Tuesday is a single Pushups card', tue.length === 1 && tue[0] === 'Pushups', tue.join(', '));

  console.log('  Wednesday:', wed.length, 'cards -', wed.join(', '));
  check('Wednesday is the 14-card gym day, pulling exercises included', wed.length === 14 && wed[0] === 'Leg Press'
    && wed.includes('Lat Pulldown') && wed.includes('Face Pull') && wed.includes('Pull-ups'), wed.join(', '));
  check('Machine Chest Press and Tricep Pushdown are gone from Wednesday',
    !wed.includes('Machine Chest Press') && !wed.includes('Tricep Pushdown'), wed.join(', '));

  console.log('  Thursday:', thu.length, 'cards -', thu.join(', '));
  check('Thursday is a single Pushups card', thu.length === 1 && thu[0] === 'Pushups', thu.join(', '));

  console.log('  Friday:', fri.length, 'cards -', fri.join(', '));
  check('Friday is the 11-card gym day, pulling exercises included', fri.length === 11 && fri[0] === 'Leg Press'
    && fri.includes('Dumbbell Romanian Deadlift') && fri.includes('Lat Pulldown') && fri.includes('Face Pull'), fri.join(', '));
  check('Inclined Dumbbell Chest Press and Tricep Pulldown are gone from Friday',
    !fri.includes('Inclined Dumbbell Chest Press') && !fri.includes('Tricep Pulldown'), fri.join(', '));

  console.log('  Saturday:', sat.length, 'cards -', sat.join(', '));
  check('Saturday is the short Pushups/Walk/Sauna day',
    sat.length === 3 && sat.includes('Pushups') && sat.includes('Walk') && sat.includes('Sauna'), sat.join(', '));

  console.log('  Sunday:', sun.length, 'cards -', sun.join(', '));
  check('Sunday is a rest day (no cards)', sun.length === 0, sun.join(', '));

  const tabTypes = await page.evaluate(() => [...document.querySelectorAll('.day-tab .tab-type')].map(t => t.textContent));
  check('the day-tab badges read Rest/PU/Gym/PU/Gym/Mob/Rest for Mon-Sun',
    JSON.stringify(tabTypes) === JSON.stringify(['Rest', 'PU', 'Gym', 'PU', 'Gym', 'Mob', 'Rest']), JSON.stringify(tabTypes));

  const groups = await page.evaluate(() => ['Dumbbell Romanian Deadlift', 'Standing Calf Raise', 'Face Pull']
    .map(n => n + ' -> ' + muscleFor_(n)));
  groups.forEach(g => console.log('  ', g));
  check('the exercises still classify correctly',
    groups[0].endsWith('Hamstrings') && groups[1].endsWith('Calves') && groups[2].endsWith('Shoulders'),
    groups.join(' | '));

  console.log('\n=== The Aug 24 Wednesday migration still safely clears stale Wednesday state ===');
  await page.evaluate(() => {
    // Pretend the 24th migration has not run yet, and lay down a saved
    // state shaped like the old (pre-Aug-24) twelve-card Wednesday - the
    // exact shape that migration exists to clear out. Wednesday's CURRENT
    // template is unrelated (now the 14-card gym day with pulling work);
    // the migration should still wipe the stale array rather than try to
    // merge it in.
    localStorage.removeItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260824');
    const state = JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE') || '{"days":{}}');
    state.days = state.days || {};
    state.days.wed = { exercises: Array.from({ length: 12 }, (_, i) => ({ id: 'ex' + i, sets: [] })), checklist: {} };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(state));
  });
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const wedAfterMigration = await cardsFor('wed');
  console.log('  Wednesday after migration:', wedAfterMigration.join(', '));
  check('the stale 12-card Wednesday is cleared, showing the current 14-card gym template cleanly',
    wedAfterMigration.length === 14 && wedAfterMigration[0] === 'Leg Press', wedAfterMigration.join(', '));

  await ctx.close();
  await b.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
