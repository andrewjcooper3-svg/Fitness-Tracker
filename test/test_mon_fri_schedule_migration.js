/* Real bug report: "I dont see a monday workout" - right after gym days
   moved from Wednesday/Friday to Monday/Wednesday.

   Root cause: Monday was a fixed rest day for its entire history, so
   every device already has WORKOUT_TRACKER_STATE with
   days.mon = { exercises: [], ... } - serializeDay() maps zero
   .exercise-card elements to exactly that empty array, every single
   save. restoreDay's deletedEverything branch (added for a real earlier
   bug: "deleting a day's only exercise never pruned") cannot tell that
   apart from a genuine "the user deleted every exercise on this day" -
   both are an explicit exercises: []. Left alone, Monday's harmless,
   always-empty rest-day array gets read as a deliberate delete-
   everything and prunes the fresh 11-card gym template renderWeeklyPlan_
   just built right back down to zero cards - so the user opens the app
   and Monday looks empty, exactly as reported.

   Fixed the same way the three earlier schedule moves (Jul 27, Aug 24,
   Aug 31) were: a one-time migration that deletes (not empties) the
   stale exercises key for the days whose template shape changed, which
   puts them back in the "nothing to prune against" state and lets the
   fresh template render untouched. */
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

  console.log('=== Seeding exactly what every real device already has: Monday saved as an always-empty rest day ===');
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const state = {
      week: getWeekLabel(),
      days: {
        mon: { exercises: [], checkItems: [], dayNotes: '' },
        tue: { exercises: [], checkItems: [], dayNotes: '' },
        wed: { exercises: [], checkItems: [], dayNotes: '' },
        thu: { exercises: [], checkItems: [], dayNotes: '' },
        // Friday still carries its OLD real gym data - the schedule
        // moved that content to Monday, so this is now stale too.
        fri: {
          exercises: [
            { id: 'ex0', name: 'Leg Press', sets: [{ weight: '265 lb', reps: '10', checked: true }] },
            { id: 'ex1', name: 'Dumbbell Romanian Deadlift', sets: [{ weight: '90 lb', reps: '10', checked: true }] }
          ],
          checkItems: [], dayNotes: ''
        },
        sat: { exercises: [], checkItems: [], dayNotes: '' },
        sun: { exercises: [], checkItems: [], dayNotes: '' }
      }
    };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(state));
    // Pretend this device already ran every migration through Aug 31 -
    // only the new Sep 14 one should still be pending.
    localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260727', '1');
    localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260824', '1');
    localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260831', '1');
    localStorage.removeItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260914');
  });

  console.log('\n=== Reloading - this is the exact moment the bug report describes ===');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const monCards = await page.evaluate(() =>
    [...document.querySelectorAll('#day-mon .exercise-card .exercise-name')].map(e => e.textContent));
  console.log('  Monday cards after reload:', monCards.length, '-', monCards.join(', '));
  check('Monday shows its real 11-card gym workout, not an empty day',
    monCards.length === 11 && monCards[0] === 'Leg Press' && monCards.includes('Dumbbell Romanian Deadlift'),
    monCards.join(', '));

  const friCards = await page.evaluate(() =>
    [...document.querySelectorAll('#day-fri .exercise-card')].length);
  check('Friday shows no cards (correctly a rest day now, old gym data not resurrected as customs)',
    friCards === 0, String(friCards));

  const migrated = await page.evaluate(() => localStorage.getItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260914'));
  check('the migration flag is now set (runs once)', migrated === '1', migrated);

  console.log('\n=== A second reload must not re-break anything (migration already applied, Monday now has real saved data) ===');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const monCardsAgain = await page.evaluate(() =>
    [...document.querySelectorAll('#day-mon .exercise-card .exercise-name')].map(e => e.textContent));
  check('Monday still shows all 11 cards on a normal reload', monCardsAgain.length === 11, monCardsAgain.join(', '));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
