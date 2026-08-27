/* Cardio counted in minutes, not in "sets".

   A 10-minute walk is one row in the data - one "done" - exactly like one
   rep of Leg Press, so two weekly walks sat at 2 next to a leg day's forty
   sets and made cardio look almost absent. It wasn't; the unit was wrong.

   Cardio & other is the one bucket where every entry in this app is logged
   as a duration in minutes, never a rep count, so it is weighted in
   10-minute units instead: 10 minutes is worth 1, 20 minutes is worth 2, 5
   minutes is worth 0.5. Nothing outside that bucket moves - a strength set
   still costs exactly one set, which is the comparison this guards. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof muscleBreakdown_ === 'function', null, { timeout: 15000 });

  const breakdown = rows => page.evaluate(rs => muscleBreakdown_(rs, false), rows);

  console.log('=== A walk is worth its minutes, not one flat unit ===');
  const ten = await breakdown([{ exercise: 'Walk', sets: 1, done: 1, totalReps: 10 }]);
  check('a 10-minute walk is 1 unit, same as before', ten['Cardio & other'].sets === 1,
    String(ten['Cardio & other'].sets));

  const twenty = await breakdown([{ exercise: 'Walk', sets: 1, done: 1, totalReps: 20 }]);
  check('a 20-minute walk is 2', twenty['Cardio & other'].sets === 2,
    String(twenty['Cardio & other'].sets));

  const five = await breakdown([{ exercise: 'Walk', sets: 1, done: 1, totalReps: 5 }]);
  check('and a 5-minute one is 0.5, not floored to a whole set', five['Cardio & other'].sets === 0.5,
    String(five['Cardio & other'].sets));

  console.log('\n=== Two walks and a bike ride add up honestly ===');
  const week = await breakdown([
    { exercise: 'Walk', sets: 1, done: 1, totalReps: 10 },
    { exercise: 'Walk', sets: 1, done: 1, totalReps: 10 },
    { exercise: 'Bike', sets: 1, done: 1, totalReps: 30 }
  ]);
  check('1 + 1 + 3 = 5, not 3 flat entries',
    week['Cardio & other'].sets === 5, String(week['Cardio & other'].sets));

  console.log('\n=== A strength set is untouched ===');
  const legs = await breakdown([{ exercise: 'Leg Press', sets: 3, done: 3, totalReps: 30 }]);
  check('three sets of Leg Press is still worth three, not three minutes\' worth',
    legs.Quads.sets === 3, String(legs.Quads.sets));

  console.log('\n=== A duration that never parsed falls back safely ===');
  /* Sauna's plan target is a range ("10-20 min"), and an untouched log can
     carry that text straight through rather than a number. Totally reps=0
     is what that looks like once the app tries and fails to parse it -
     falling back to the raw count, not to zero or NaN, is what keeps that
     entry from vanishing off the chart or poisoning the total. */
  const sauna = await breakdown([{ exercise: 'Sauna', sets: 1, done: 1, totalReps: 0 }]);
  check('an unparseable duration falls back to the entry count, not zero or NaN',
    sauna['Cardio & other'].sets === 1, String(sauna['Cardio & other'].sets));

  console.log('\n=== The raw count stays the literal number logged ===');
  /* raw is what lets the card show its own arithmetic - "2 walks -> 3.5
     units" for a couple of long ones. Scaling raw too would erase the very
     thing it exists to show. */
  const raw = await breakdown([
    { exercise: 'Walk', sets: 1, done: 1, totalReps: 20 },
    { exercise: 'Walk', sets: 1, done: 1, totalReps: 30 }
  ]);
  check('raw counts the two walks logged, not the 5 units they are worth',
    raw['Cardio & other'].raw.Walk === 2, String(raw['Cardio & other'].raw.Walk));
  check('while the weighted total reflects their actual length',
    raw['Cardio & other'].sets === 5, String(raw['Cardio & other'].sets));

  console.log('\n=== It shows up on the real tab ===');
  await page.addInitScript(rows => {
    localStorage.setItem('WORKOUT_HISTORY_CACHE', JSON.stringify({ rows, at: new Date().toISOString() }));
  }, [
    { date: '2026-08-24', day: 'Monday', exercise: 'Walk', sets: 1, done: 1, topWeight: 0,
      volume: 0, targetReps: 10, totalReps: 10, green: 1, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' },
    { date: '2026-08-25', day: 'Tuesday', exercise: 'Walk', sets: 1, done: 1, topWeight: 0,
      volume: 0, targetReps: 30, totalReps: 30, green: 1, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' },
    { date: '2026-08-24', day: 'Monday', exercise: 'Leg Press', sets: 3, done: 3, topWeight: 255,
      volume: 7650, targetReps: 10, totalReps: 30, green: 3, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' }
  ]);
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function'
    && typeof renderStatsTab === 'function', null, { timeout: 15000 });
  await page.evaluate(() => { showAppView('stats'); renderStatsTab(); });
  await page.waitForTimeout(600);
  const card = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#hxMuscles .hx-muscle')]
      .find(el => /Cardio/i.test(el.querySelector('.hx-muscle-name').textContent));
    return row ? row.querySelector('.hx-muscle-val').textContent : null;
  });
  check('the cardio bucket appears', !!card, card);
  // Two walks (10 + 30 min = 4 units) against a leg day of 3 sets - cardio
  // should read as the bigger bar, not the token sliver it used to be.
  check('and reads as real volume, not a token amount',
    card && parseFloat(card) >= 4, card);

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
