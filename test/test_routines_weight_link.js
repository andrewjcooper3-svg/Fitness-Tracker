/* Linking a habit to Weight isn't a threshold like Water/Pushups - it's
   just "did a weigh-in land on the Weight Log today," yes or no. That
   needed the link system to support a second kind (see ROUTINES_LINK_
   SOURCES' `kind: 'logged'` vs `kind: 'threshold'`) rather than assuming
   every linkable source is a number to clear.

   What is checked here:
     - the link dropdown offers "Weigh-in logged" and its note text is
       presence-based (no threshold/unit, unlike Water/Pushups),
     - a habit linked this way is not done until an entry for that date
       actually exists in the Weight Log, then flips to done immediately -
       and back to not-done if the entry disappears (live-tracking, not a
       frozen snapshot, same principle as the other link sources),
     - the row shows "Logged today" / "Not logged yet" instead of a
       fraction, the checkbox is disabled (auto only), and the day it
       was logged earns a green section on the calendar. */
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

  const dropdownOptions = await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    return [...document.getElementById('rtHLink').options].map(o => ({ value: o.value, text: o.textContent }));
  });
  check('the link dropdown includes Weigh-in logged', dropdownOptions.some(o => o.value === 'weight' && o.text === 'Weigh-in logged'), JSON.stringify(dropdownOptions));

  const noteBefore = await page.evaluate(() => {
    document.getElementById('rtHLink').value = 'weight';
    rtOnLinkChange();
    return document.getElementById('rtLinkNote').textContent;
  });
  check('the note text is presence-based, no threshold/unit shown', /weigh-in is logged/.test(noteBefore) && !/undefinedundefined/.test(noteBefore), noteBefore);

  await page.evaluate(() => {
    document.getElementById('rtHName').value = 'Weigh myself';
    rtSetCadence('daily');
    rtSaveHabit();
  });
  await page.waitForTimeout(200);

  const habit = await page.evaluate(() => RT_HABITS.list.find(h => h.name === 'Weigh myself'));
  check('the habit was saved with a weight link and no threshold key', habit && habit.link && habit.link.source === 'weight' && habit.link.threshold === undefined, JSON.stringify(habit));

  const beforeWeighIn = await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Weigh myself');
    return rtIsDoneOn(h, dateKey(rtToday));
  });
  check('not done before any weight entry exists for today', beforeWeighIn === false);

  const rowMetaBefore = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rtTodayList .rt-item-row')].find(r => /Weigh myself/.test(r.textContent));
    return row.querySelector('.rt-item-meta').textContent;
  });
  check('row shows "Not logged yet" before a weigh-in', /Not logged yet/.test(rowMetaBefore), rowMetaBefore);

  const checkboxDisabled = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rtTodayList .rt-item-row')].find(r => /Weigh myself/.test(r.textContent));
    return row.querySelector('.rt-check').disabled;
  });
  check('the checkbox is disabled (auto only, no manual toggle)', checkboxDisabled === true);

  // Simulate the Shortcut logging a weigh-in for today, same as syncWeightEntryToBackend's local write.
  await page.evaluate(() => {
    const log = loadWeightLog();
    log.push({ date: dateKey(rtToday), weight: 182.4, bodyFat: null });
    saveWeightLog(log);
    rtRenderAll();
  });
  await page.waitForTimeout(200);

  const afterWeighIn = await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Weigh myself');
    return rtIsDoneOn(h, dateKey(rtToday));
  });
  check('marked done once a weight entry for today exists', afterWeighIn === true);

  const rowMetaAfter = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rtTodayList .rt-item-row')].find(r => /Weigh myself/.test(r.textContent));
    return row.querySelector('.rt-item-meta').textContent;
  });
  check('row shows "Logged today" after the weigh-in', /Logged today/.test(rowMetaAfter), rowMetaAfter);

  const checkedNow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rtTodayList .rt-item-row')].find(r => /Weigh myself/.test(r.textContent));
    return row.querySelector('.rt-check').classList.contains('done');
  });
  check('checkbox visually shows done', checkedNow === true);

  const daySection = await page.evaluate(() => {
    const cell = document.querySelector(`#rtMonthGrid [data-date="${dateKey(rtToday)}"]`);
    return cell ? [...cell.querySelectorAll('.rt-day-sections > span')].map(s => ({ cls: s.className, title: s.title })) : null;
  });
  check('today\'s calendar cell shows a green section for the weight habit', daySection && daySection.some(s => s.cls === 'rt-sec-done' && s.title === 'Weigh myself'), JSON.stringify(daySection));

  // Remove the entry - should flip back to not done (live-tracking, not a snapshot).
  await page.evaluate(() => {
    saveWeightLog(loadWeightLog().filter(e => e.date !== dateKey(rtToday)));
  });
  const afterRemoval = await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Weigh myself');
    return rtIsDoneOn(h, dateKey(rtToday));
  });
  check('removing the weigh-in flips it back to not done', afterRemoval === false);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
