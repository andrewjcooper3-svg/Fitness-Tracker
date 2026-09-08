/* Exercise ids are assigned purely by position within a day ('ex0', 'ex1',
   ...), not by exercise identity - fine while a day's exercise list stays
   the same shape, but when a plan edit moves exercises between days (like
   the Tue/Thu -> Wed/Fri gym-day swap), a device's saved mid-week state
   still has the OLD day's ids and exercise count. Restoring that onto the
   NEW day's freshly-rendered cards used to prune the correct new cards as
   "not in the saved state" and resurrect the old exercises as bare custom
   cards with stale weights - Wednesday came out looking empty, Tuesday
   came out full of blank leftover entries. restoreDay() now checks the
   saved exercise NAMES against the day's current plan before trusting the
   ids at all, and skips restoring exercise data entirely when they no
   longer match, leaving the fresh defaults exactly as planned. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  console.log('=== A mid-week saved state from the OLD (Tue/Thu gym) schedule no longer corrupts the new one ===');
  const result = await page.evaluate(() => {
    const fakeSets = (n, weight, reps) => Array.from({ length: n }, () => ({ weight, reps, notes: '', checked: false }));
    const saved = {
      week: getWeekLabel(),
      days: {
        // Old Tuesday: the full gym list, saved under the OLD schedule.
        tue: {
          exercises: [
            { id: 'ex0', name: 'Leg Press', sets: fakeSets(3, '255 lb', '10') },
            { id: 'ex1', name: 'Leg Extension', sets: fakeSets(3, '110 lb', '12') },
            { id: 'ex2', name: 'Leg Curl', sets: fakeSets(3, '80 lb', '12') }
          ],
          checkItems: [],
          dayNotes: ''
        },
        // Old Wednesday: just the simple bodyweight pushup day.
        wed: {
          exercises: [
            { id: 'ex0', name: 'Pushups', sets: fakeSets(3, 'BW', '55') }
          ],
          checkItems: [],
          dayNotes: ''
        },
        // Saturday's plan did NOT change - this should still restore
        // normally, proving the fix doesn't break the common case.
        sat: {
          exercises: [
            { id: 'ex0', name: 'Pushups', sets: [{ weight: 'BW', reps: '55', notes: '', checked: true }, { weight: 'BW', reps: '55', notes: '', checked: false }, { weight: 'BW', reps: '55', notes: '', checked: false }, { weight: 'BW', reps: '55', notes: '', checked: false }] },
            { id: 'ex1', name: 'Walk', sets: [{ weight: 'BW', reps: '10 minutes', notes: 'treadmill test note', checked: true }] },
            { id: 'ex2', name: 'Sauna', sets: [{ weight: 'BW', reps: '10-20 min', notes: '', checked: false }] }
          ],
          checkItems: [],
          dayNotes: 'Felt good today'
        }
      }
    };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(saved));
    restoreState();

    const namesOf = day => [...document.querySelectorAll(`#day-${day} .exercise-card`)].map(getExerciseName);
    return {
      tueNames: namesOf('tue'),
      wedNames: namesOf('wed'),
      satNames: namesOf('sat'),
      satFirstSetChecked: document.querySelector('#day-sat .exercise-card .set-checkbox').classList.contains('checked'),
      satWalkNote: [...document.querySelectorAll('#day-sat .exercise-card')[1].querySelector('.set-row').querySelectorAll('.set-input')].pop().value,
      satDayNotes: document.querySelector('#day-sat .day-notes-input').value
    };
  });

  check('Tuesday shows only Pushups - no leftover gym exercises', result.tueNames.length === 1 && result.tueNames[0] === 'Pushups', JSON.stringify(result.tueNames));
  check('Wednesday shows the full gym list, not just the old single Pushups card',
    result.wedNames.length > 5 && result.wedNames.includes('Leg Press') && result.wedNames.includes('Reverse Pec Deck Fly'),
    JSON.stringify(result.wedNames));
  check('Saturday (an unchanged day) still restores its saved exercises', JSON.stringify(result.satNames) === JSON.stringify(['Pushups', 'Walk', 'Sauna']), JSON.stringify(result.satNames));
  check('Saturday\'s saved checkbox state still restores', result.satFirstSetChecked === true);
  check('Saturday\'s saved set note still restores', result.satWalkNote === 'treadmill test note', result.satWalkNote);
  check('Saturday\'s saved day notes still restore', result.satDayNotes === 'Felt good today', result.satDayNotes);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
