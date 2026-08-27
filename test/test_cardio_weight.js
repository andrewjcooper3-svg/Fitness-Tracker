/* Cardio counted by effort, not just by the clock.

   Counting minutes alone (the first version of this) fixed one problem and
   created a smaller copy of it: ten easy minutes of walking and ten hard
   minutes of running landed on the same number, which overstates the easy
   session and understates the hard one. So the rate per 10 minutes now
   follows effort, roughly by MET (Compendium of Physical Activities,
   rounded for a chart rather than a lab), anchored so moderate sustained
   cardio - jogging, cycling, rowing - sits at 1 unit per 10 minutes, the
   same reference point the flat version used for everything.

   What is checked here:
     - the rate table itself, spot-checked against a few exercises,
     - that harder cardio outweighs easier cardio for the SAME duration,
       which is the entire point of this over counting minutes alone,
     - that a strength set is completely unaffected,
     - the raw count (what the card shows as "how many times logged")
       stays literal - it is duration- AND effort-scaling that must never
       touch it, or the card loses the arithmetic it exists to show,
     - and the safety net when a duration never parsed to a real number. */
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
  const tenMin = ex => ({ exercise: ex, sets: 1, done: 1, totalReps: 10 });

  console.log('=== The rate table, spot-checked ===');
  const RATE = {
    Walk: 0.5, Jog: 1.0, Run: 1.4, Bike: 1.0, 'Rowing Machine': 1.0,
    'Stair Master': 1.3, Elliptical: 0.7, Yoga: 0.4, Stretching: 0.3, Sauna: 0.2
  };
  for (const [ex, rate] of Object.entries(RATE)) {
    const got = (await breakdown([tenMin(ex)]))['Cardio & other'].sets;
    check(`${ex}: 10 minutes is worth ${rate}`, got === rate, `got ${got}`);
  }

  console.log('\n=== Harder cardio outweighs easier cardio at the same duration ===');
  /* This is the whole point of moving off flat minutes: ten minutes of
     running has to count for more than ten minutes of walking, and it did
     not under a flat per-minute rate. */
  const run10 = (await breakdown([tenMin('Run')]))['Cardio & other'].sets;
  const walk10 = (await breakdown([tenMin('Walk')]))['Cardio & other'].sets;
  check('ten minutes running outweighs ten minutes walking', run10 > walk10,
    `run ${run10} vs walk ${walk10}`);
  check('and by the ratio the rate table sets, not some other amount',
    Math.abs(run10 / walk10 - 1.4 / 0.5) < 0.01, `${run10} / ${walk10}`);

  console.log('\n=== A longer easy session can still beat a short hard one, honestly ===');
  /* Not "harder always wins" - a 30-minute walk (0.5 x 3 = 1.5) is
     legitimately more total effort than a 10-minute run (1.4). Duration and
     effort both matter, multiplied together, not one overriding the other. */
  const longWalk = (await breakdown([{ exercise: 'Walk', sets: 1, done: 1, totalReps: 30 }]))['Cardio & other'].sets;
  const shortRun = (await breakdown([tenMin('Run')]))['Cardio & other'].sets;
  check('30 easy minutes can outweigh 10 hard ones', longWalk > shortRun,
    `30-min walk ${longWalk} vs 10-min run ${shortRun}`);

  console.log('\n=== A strength set is completely unaffected ===');
  const legs = await breakdown([{ exercise: 'Leg Press', sets: 3, done: 3, totalReps: 30 }]);
  check('three sets of Leg Press is still worth exactly three',
    legs.Quads.sets === 3, String(legs.Quads.sets));

  console.log('\n=== Two sessions add up honestly ===');
  const week = await breakdown([
    tenMin('Walk'), tenMin('Walk'),                                    // 0.5 + 0.5
    { exercise: 'Bike', sets: 1, done: 1, totalReps: 30 }               // 3.0
  ]);
  check('0.5 + 0.5 + 3 = 4', week['Cardio & other'].sets === 4,
    String(week['Cardio & other'].sets));

  console.log('\n=== A duration that never parsed falls back safely ===');
  /* Sauna's plan target is a range ("10-20 min"), and an untouched log can
     carry that text straight through rather than a number. Falling back to
     the raw count, not zero or NaN, is what keeps that entry from
     vanishing off the chart or poisoning the total. */
  const sauna = await breakdown([{ exercise: 'Sauna', sets: 1, done: 1, totalReps: 0 }]);
  check('an unparseable duration falls back to the entry count, not zero or NaN',
    sauna['Cardio & other'].sets === 1, String(sauna['Cardio & other'].sets));

  console.log('\n=== An unrecognised cardio name gets a moderate default ===');
  // "Cardio Session" lands in the bucket (it matches the bare "cardio"
  // keyword) but matches none of the specific rate patterns. Guessing
  // "light" or "hard" for one nobody wrote a rule for would be worse than
  // a plain moderate default.
  const mystery = await breakdown([tenMin('Cardio Session')]);
  check('falls through to 1.0 rather than 0 or a guess',
    mystery['Cardio & other'].sets === 1, String(mystery['Cardio & other'].sets));

  console.log('\n=== The raw count stays the literal number logged ===');
  /* raw is what lets the card show its own arithmetic - it must reflect
     how many times you logged something, never the duration- or
     effort-scaled figure, or the card loses the very thing it exists to
     show. */
  const raw = await breakdown([
    { exercise: 'Walk', sets: 1, done: 1, totalReps: 20 },              // 1.0
    { exercise: 'Run', sets: 1, done: 1, totalReps: 20 }                // 2.8
  ]);
  check('raw counts two sessions logged, not the 3.8 units they are worth',
    raw['Cardio & other'].raw.Walk === 1 && raw['Cardio & other'].raw.Run === 1,
    JSON.stringify(raw['Cardio & other'].raw));
  check('while the weighted total reflects their actual effort',
    Math.abs(raw['Cardio & other'].sets - 3.8) < 0.01, String(raw['Cardio & other'].sets));

  console.log('\n=== It shows up on the real tab ===');
  await page.addInitScript(rows => {
    localStorage.setItem('WORKOUT_HISTORY_CACHE', JSON.stringify({ rows, at: new Date().toISOString() }));
  }, [
    { date: '2026-08-24', day: 'Monday', exercise: 'Run', sets: 1, done: 1, topWeight: 0,
      volume: 0, targetReps: 20, totalReps: 20, green: 1, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' },
    { date: '2026-08-25', day: 'Tuesday', exercise: 'Walk', sets: 1, done: 1, topWeight: 0,
      volume: 0, targetReps: 10, totalReps: 10, green: 1, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' },
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
  // A 20-min run (2.8) + a 10-min walk (0.5) = 3.3, against 3 sets of legs.
  check('and the total matches the effort-weighted arithmetic',
    card && Math.abs(parseFloat(card) - 3.3) < 0.05, card);

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
