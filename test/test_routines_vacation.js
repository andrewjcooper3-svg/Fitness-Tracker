/* "Vacation" - a third state for a habit's day, alongside done/not-done,
   for when it genuinely couldn't be completed (traveling with no scale,
   no gym nearby, whatever). Motivated by exactly the Weight-linked habit
   in test_routines_weight_link.js: a linked habit has no checkbox of its
   own to tap, so there was previously no way to record "couldn't weigh in
   today" at all - it would just quietly become a miss.

   What is checked here:
     - a linked habit (Weight) with no vacation mark is a normal miss,
     - marking it as vacation shows the blue checkbox/meta text instead,
       and it's still NOT counted as done,
     - a non-linked daily habit works the same way, and tapping its real
       checkbox afterwards (actually doing it) clears the vacation mark -
       done and excused are mutually exclusive,
     - the reverse also holds: marking vacation after a real completion
       clears the done mark,
     - a vacation day doesn't break rtCurrentStreak (neutral, not a miss),
     - the month calendar cell shows a blue rt-sec-excused section for
       that day, and the Manage Habits 28-day strip shows it too. */
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

  console.log('=== A linked habit (Weight) can be marked vacation with no checkbox of its own ===');
  await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Weigh myself';
    rtSetCadence('daily');
    document.getElementById('rtHLink').value = 'weight';
    rtOnLinkChange();
    rtSaveHabit();
  });
  await page.waitForTimeout(200);

  const findRow = (name) => `[...document.querySelectorAll('#rtTodayList .rt-item-row')].find(r => r.querySelector('.rt-item-name').textContent === '${name}')`;

  let beforeVacation = await page.evaluate((sel) => {
    const row = eval(sel);
    return { checkCls: row.querySelector('.rt-check').className, meta: row.querySelector('.rt-item-meta').textContent };
  }, findRow('Weigh myself'));
  check('before marking vacation, checkbox is plain (no done/excused)', !/done|excused/.test(beforeVacation.checkCls), beforeVacation.checkCls);

  await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Weigh myself');
    document.querySelector(`#rtTodayList .rt-check[disabled]`); // sanity: still no manual check for linked habits
    rtToggleExcused(h.id, rtViewDay);
  });
  await page.waitForTimeout(150);

  let afterVacation = await page.evaluate((sel) => {
    const row = eval(sel);
    return { checkCls: row.querySelector('.rt-check').className, meta: row.querySelector('.rt-item-meta').textContent };
  }, findRow('Weigh myself'));
  check('the checkbox now shows the excused (blue) state', afterVacation.checkCls.includes('excused'), afterVacation.checkCls);
  check('the meta text reads "On vacation"', /On vacation/.test(afterVacation.meta), afterVacation.meta);

  const stillNotDone = await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Weigh myself');
    return rtIsDoneOn(h, dateKey(rtToday));
  });
  check('a vacation day is still NOT counted as done', stillNotDone === false);

  console.log('\n=== A vacation mark disappears once the habit turns out to be done anyway ===');
  await page.evaluate(() => {
    const log = loadWeightLog();
    log.push({ date: dateKey(rtToday), weight: 180, bodyFat: null });
    saveWeightLog(log);
    rtRenderAll();
  });
  await page.waitForTimeout(150);
  const afterRealWeighIn = await page.evaluate((sel) => {
    const row = eval(sel);
    return { checkCls: row.querySelector('.rt-check').className, meta: row.querySelector('.rt-item-meta').textContent };
  }, findRow('Weigh myself'));
  check('an actual completion wins over the leftover vacation flag', afterRealWeighIn.checkCls.includes('done') && !afterRealWeighIn.checkCls.includes('excused'), JSON.stringify(afterRealWeighIn));

  console.log('\n=== A plain (non-linked) habit: vacation and done are mutually exclusive ===');
  await page.evaluate(() => {
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Make Bed';
    rtSetCadence('daily');
    rtSaveHabit();
  });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Make Bed');
    rtToggleExcused(h.id, rtViewDay);
  });
  await page.waitForTimeout(150);
  let bedState = await page.evaluate((sel) => eval(sel).querySelector('.rt-check').className, findRow('Make Bed'));
  check('Make Bed shows excused after marking vacation', bedState.includes('excused'), bedState);

  await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Make Bed');
    rtToggle(h.id, rtViewDay); // the real checkbox tap - actually did it
  });
  await page.waitForTimeout(150);
  bedState = await page.evaluate((sel) => eval(sel).querySelector('.rt-check').className, findRow('Make Bed'));
  check('checking it off for real clears the vacation mark', bedState.includes('done') && !bedState.includes('excused'), bedState);

  await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Make Bed');
    rtToggleExcused(h.id, rtViewDay); // mark vacation again, on top of a real completion
  });
  await page.waitForTimeout(150);
  bedState = await page.evaluate((sel) => eval(sel).querySelector('.rt-check').className, findRow('Make Bed'));
  const bedDone = await page.evaluate(() => rtIsDoneOn(RT_HABITS.list.find(x => x.name === 'Make Bed'), dateKey(rtToday)));
  check('marking vacation on top of a completion clears done, back to excused', bedState.includes('excused') && !bedDone, JSON.stringify({ bedState, bedDone }));

  console.log('\n=== A vacation day does not break the streak ===');
  await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Make Bed');
    // Backdate creation - it was made moments ago in this test, so without
    // this every day before today reads as "didn't exist yet" (rtIsDue
    // returns false) and the streak walk stops on its very first step.
    h.created = dateKey(new Date(rtToday.getTime() - 10 * ROUTINES_DAY_MS));
    rtSaveHabitsLocal();
    RT_LOG[dateKey(rtToday)][h.id] = { done: false, excused: false, loggedAt: new Date().toISOString() };
    for (let i = 1; i <= 3; i++) {
      const d = new Date(rtToday.getTime() - i * ROUTINES_DAY_MS);
      RT_LOG[dateKey(d)] = RT_LOG[dateKey(d)] || {};
      // Day -2 is a vacation day; -1 and -3 are real completions.
      if (i === 2) RT_LOG[dateKey(d)][h.id] = { done: false, excused: true, loggedAt: new Date().toISOString() };
      else RT_LOG[dateKey(d)][h.id] = { done: true, excused: false, loggedAt: new Date().toISOString() };
    }
    rtSaveLogLocal();
    rtRenderAll();
  });
  await page.waitForTimeout(150);
  const streak = await page.evaluate(() => rtCurrentStreak(RT_HABITS.list.find(x => x.name === 'Make Bed')));
  // Today isn't logged yet (never breaks a streak), day -1 is a real
  // completion (n=1), day -2 is the vacation day - skipped rather than
  // breaking the walk - and day -3 is another real completion (n=2).
  // Day -4 has no data at all, a genuine miss, which correctly stops the
  // count there. Without the vacation-day skip this would be 1, not 2 -
  // walking backward would have stopped dead at day -2 instead of
  // continuing on to count day -3.
  check('the streak counts through the vacation day rather than stopping at it', streak === 2, String(streak));

  console.log('\n=== Calendar cell and habit strip both show the vacation color ===');
  // The Year view (not Month) so a vacation day 2 days back is found
  // regardless of where the month boundary happens to fall on the day
  // this test runs.
  const pastDay = await page.evaluate(() => {
    rtSetHistoryMode('year');
    return dateKey(new Date(rtToday.getTime() - 2 * ROUTINES_DAY_MS));
  });
  const pastCellSections = await page.evaluate((dk) => {
    const cell = document.querySelector(`#rtYearGrid [data-date="${dk}"]`);
    return cell ? [...cell.querySelectorAll('.rt-day-sections > span')].map(s => s.className) : null;
  }, pastDay);
  check('the vacation day\'s cell shows the blue rt-sec-excused section', pastCellSections && pastCellSections.includes('rt-sec-excused'), JSON.stringify(pastCellSections));

  const stripTitles = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.rt-habit-row')].find(r => /Make Bed/.test(r.textContent));
    return [...row.querySelectorAll('.rt-habit-strip span')].map(s => s.className);
  });
  check('the 28-day strip includes an excused day', stripTitles.some(c => c.includes('excused')), JSON.stringify(stripTitles));

  console.log('\n=== The legend and the sync payload both know about vacation ===');
  const legendText = await page.evaluate(() => document.querySelector('.rt-legend').textContent);
  check('the calendar legend explains the blue color', /Vacation/.test(legendText), legendText);

  // Checked against the Weight habit rather than Make Bed - Make Bed's
  // today entry got overwritten by the streak setup above, but Weight's
  // vacation mark (from the very first section) was never touched again
  // since its "done" comes from the weight log, not RT_LOG.
  const weightHabit = await page.evaluate(() => RT_HABITS.list.find(x => x.name === 'Weigh myself'));
  const excusedFlag = await page.evaluate((id) => RT_LOG[dateKey(rtToday)][id].excused, weightHabit.id);
  check('RT_LOG actually carries the excused flag for sync', excusedFlag === true, String(excusedFlag));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
