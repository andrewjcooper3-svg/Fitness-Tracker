// The new Wednesday has to appear in full, and Monday's already-completed
// work has to survive the template change untouched. That second half is
// the whole risk: exercise ids are assigned by DOM position, so a botched
// migration silently prunes cards.
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

  // First load on the OLD build: fill Monday in, and put something on
  // Wednesday too, so the migration has real state to act on.
  await page.goto(URL);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    // Pretend the 24th migration has not run yet, and lay down a saved
    // state shaped like the old twelve-card Wednesday.
    localStorage.removeItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260824');
    const state = JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE') || '{"days":{}}');
    state.days = state.days || {};
    // A realistic completed Monday: all twelve cards, with the first one
    // filled in. Saving only ex0 would correctly prune the other eleven.
    state.days.mon = { exercises: Array.from({ length: 12 }, (_, i) => ({
      id: 'ex' + i,
      sets: i === 0
        ? [{ weight: '255', reps: '10', notes: 'felt good', checked: true, quality: 'green' }]
        : []
    })), checklist: {} };
    state.days.wed = { exercises: Array.from({ length: 12 }, (_, i) => ({ id: 'ex' + i, sets: [] })), checklist: {} };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(state));
  });
  await page.reload();
  await page.waitForTimeout(1500);

  const wed = await page.evaluate(() =>
    [...document.querySelectorAll('#day-wed .exercise-card .exercise-name')].map(e => e.textContent));
  const mon = await page.evaluate(() =>
    [...document.querySelectorAll('#day-mon .exercise-card .exercise-name')].map(e => e.textContent));
  console.log('  Wednesday:', wed.length, 'cards');
  wed.forEach(n => console.log('    -', n));

  check('Wednesday renders all 13 cards', wed.length === 13, String(wed.length));
  ['Leg Press', 'Dumbbell Romanian Deadlift', 'Leg Curl', 'Lat Pulldown',
   'CS DB Row (Left Arm Focus)', 'Inclined Dumbbell Chest Press', 'Face Pull',
   'Tricep Pulldown', 'Cable Bicep Curl', 'Standing Calf Raise', 'Cable Crunch',
   'Pushups', 'Walk'].forEach(n =>
    check(`  ${n} is there`, wed.includes(n)));
  check('Machine Chest Press is gone from Wednesday', !wed.includes('Machine Chest Press'));
  check('Hanging Knee Raise is gone from Wednesday', !wed.includes('Hanging Knee Raise'));

  console.log('\n  Monday:', mon.length, 'cards');
  check('Monday is untouched', mon.length === 12 && mon[0] === 'Leg Press'
    && mon.includes('Machine Chest Press') && mon.includes('Lateral Raise'), mon.join(', '));

  // The actual risk: does Monday's logged set survive?
  const kept = await page.evaluate(() => {
    const card = document.querySelector('#day-mon .exercise-card');
    const inputs = [...card.querySelectorAll('.set-row .set-input')].map(i => i.value);
    return { inputs, checked: !!card.querySelector('.set-checkbox.checked') };
  });
  console.log('  Monday first card inputs:', JSON.stringify(kept));
  check("Monday's logged weight survived", kept.inputs[0] === '255', kept.inputs.join('|'));
  check("Monday's note survived", kept.inputs.includes('felt good'), kept.inputs.join('|'));
  check("Monday's checkmark survived", kept.checked);

  // Set counts, and that the new work classifies into the right groups.
  const rows = await page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('#day-wed .exercise-card')].forEach(c => {
      out[c.querySelector('.exercise-name').textContent] = c.querySelectorAll('.set-row').length;
    });
    return out;
  });
  console.log('  sets:', JSON.stringify(rows));
  check('Leg Press trimmed to 3', rows['Leg Press'] === 3, String(rows['Leg Press']));
  check('Leg Curl trimmed to 3', rows['Leg Curl'] === 3, String(rows['Leg Curl']));
  check('RDL has 3', rows['Dumbbell Romanian Deadlift'] === 3);
  check('Calf raise has 3', rows['Standing Calf Raise'] === 3);
  check('Face pull has 3', rows['Face Pull'] === 3);
  check('the left-arm row work is preserved at 4', rows['CS DB Row (Left Arm Focus)'] === 4);

  const groups = await page.evaluate(() => ['Dumbbell Romanian Deadlift', 'Standing Calf Raise', 'Face Pull']
    .map(n => n + ' -> ' + muscleFor_(n)));
  groups.forEach(g => console.log('  ', g));
  check('the new work classifies correctly',
    groups[0].endsWith('Hamstrings') && groups[1].endsWith('Calves') && groups[2].endsWith('Shoulders'),
    groups.join(' | '));

  await ctx.close();
  await b.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
