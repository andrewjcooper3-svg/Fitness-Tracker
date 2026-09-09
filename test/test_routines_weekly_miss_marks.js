/* A week-cadence habit ("3x/week") has no single day it's "due" on, so a
   shortfall used to just vanish silently once the week ended - nothing on
   the calendar showed that a 3x/week habit done only once actually missed
   its target twice. Per the user's request, once a week is OVER, the
   deficit (target minus however many days it was actually completed) now
   gets retroactively attributed to that many of the week's other days as
   red "missed" marks - so a 3x/week habit done once in a completed week
   shows 2 additional red marks on 2 different days that week.

   What is checked here:
     - a completed past week, 3x/week target, done once (Monday): exactly
       2 OTHER days in that week get a miss mark, chosen by scanning
       backward from Sunday (matching rtWeekMissDays_'s stated design),
     - the day that WAS done does not also get a miss mark,
     - the CURRENT in-progress week, even sitting under target, shows NO
       miss marks yet - only a completed week is ever judged,
     - rtRenderHeatDetail() labels a marked day "Weekly target missed",
     - the 28-day strip in rtRenderHabits() shows the same miss dots. */
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

  console.log('=== Setup: a 3x/week habit, done once (Monday) in a fully-completed past week ===');
  const setup = await page.evaluate(() => {
    showAppView('routines');
    rtOpenHabitSheet();
    document.getElementById('rtHName').value = 'Stretch';
    rtSetCadence('week'); // default rtDraftWeekTarget is 3
    rtSaveHabit();
    const h = RT_HABITS.list.find(x => x.name === 'Stretch');
    // Backdate creation well before the test week so rtWeekMissDays_'s
    // "didn't exist yet" guard doesn't suppress the marks.
    h.created = dateKey(new Date(rtToday.getTime() - 30 * ROUTINES_DAY_MS));
    rtSaveHabitsLocal();

    const curWeekStart = rtWeekStart(rtToday);
    const prevWeekStart = new Date(curWeekStart.getTime() - 7 * ROUTINES_DAY_MS);
    const weekDates = Array.from({ length: 7 }, (_, i) => dateKey(new Date(prevWeekStart.getTime() + i * ROUTINES_DAY_MS)));
    const monday = weekDates[0];
    RT_LOG[monday] = RT_LOG[monday] || {};
    RT_LOG[monday][h.id] = { done: true, excused: false, loggedAt: new Date().toISOString() };
    rtSaveLogLocal();
    rtRenderAll();

    return { habitId: h.id, weekDates }; // [mon, tue, wed, thu, fri, sat, sun]
  });
  const { weekDates } = setup;
  const [mon, tue, wed, thu, fri, sat, sun] = weekDates;

  const missDays = await page.evaluate((k) => {
    const h = RT_HABITS.list.find(x => x.name === 'Stretch');
    const ws = rtWeekStart(new Date(k + 'T00:00:00'));
    return [...rtWeekMissDays_(h, ws)];
  }, mon);
  check('exactly 2 days get a retroactive miss mark (3 target - 1 done)', missDays.length === 2, JSON.stringify(missDays));
  check('the miss days are Sunday and Saturday (scanned backward from Sunday)', new Set(missDays).size === 2 && missDays.includes(sun) && missDays.includes(sat), JSON.stringify({ missDays, sun, sat }));
  check('Monday (the day actually done) is not among the miss days', !missDays.includes(mon), JSON.stringify(missDays));
  check('the untouched weekdays (Tue/Wed/Thu/Fri) are not miss days', ![tue, wed, thu, fri].some(d => missDays.includes(d)), JSON.stringify(missDays));

  console.log('\n=== The calendar (year grid) shows red rt-sec-miss sections on exactly those 2 days ===');
  await page.evaluate(() => rtSetHistoryMode('year'));
  await page.waitForTimeout(150);
  const sectionsFor = async (dk) => page.evaluate((k) => {
    const cell = document.querySelector(`#rtYearGrid [data-date="${k}"]`);
    return cell ? [...cell.querySelectorAll('.rt-day-sections > span')].map(s => s.className) : null;
  }, dk);
  const sunSections = await sectionsFor(sun);
  const satSections = await sectionsFor(sat);
  const monSections = await sectionsFor(mon);
  const wedSections = await sectionsFor(wed);
  check('Sunday\'s cell carries a rt-sec-miss section', sunSections && sunSections.includes('rt-sec-miss'), JSON.stringify(sunSections));
  check('Saturday\'s cell carries a rt-sec-miss section', satSections && satSections.includes('rt-sec-miss'), JSON.stringify(satSections));
  check('Monday\'s cell (the day it was done) shows done, not miss, for this habit', monSections && monSections.includes('rt-sec-done') && !monSections.includes('rt-sec-miss'), JSON.stringify(monSections));
  check('Wednesday\'s cell (untouched weekday) shows no section for this habit at all', !wedSections || !wedSections.length, JSON.stringify(wedSections));

  console.log('\n=== The CURRENT in-progress week shows no miss marks, even under target ===');
  const curWeekCheck = await page.evaluate(() => {
    const h = RT_HABITS.list.find(x => x.name === 'Stretch');
    const days = Array.from({ length: 7 }, (_, i) => dateKey(new Date(rtWeekStart(rtToday).getTime() + i * ROUTINES_DAY_MS)));
    return days.filter(dk => new Date(dk + 'T00:00:00') <= rtToday).map(dk => {
      const cell = document.querySelector(`#rtYearGrid [data-date="${dk}"]`);
      const cls = cell ? [...cell.querySelectorAll('.rt-day-sections > span')].map(s => s.className) : [];
      return { dk, hasMiss: cls.includes('rt-sec-miss') };
    });
  });
  check('no day in the current week has a miss mark for the week-cadence habit', curWeekCheck.every(d => !d.hasMiss), JSON.stringify(curWeekCheck));

  console.log('\n=== rtRenderHeatDetail() labels a marked day "Weekly target missed" ===');
  const heatDetail = await page.evaluate((dk) => {
    rtSelectedDay = dk;
    rtRenderHeatDetail();
    const item = [...document.querySelectorAll('#rtHeatDetail .rt-heat-detail-item')].find(el => /Stretch/.test(el.textContent));
    return item ? { cls: item.className, text: item.textContent } : null;
  }, sun);
  check('the heat detail item for Sunday is classed "miss"', heatDetail && heatDetail.cls.includes('miss'), JSON.stringify(heatDetail));
  check('the heat detail text reads "Weekly target missed"', heatDetail && /Weekly target missed/.test(heatDetail.text), JSON.stringify(heatDetail));

  console.log('\n=== The 28-day strip in rtRenderHabits() shows the same miss dots ===');
  await page.evaluate(() => rtRenderHabits());
  await page.waitForTimeout(150);
  const stripInfo = await page.evaluate((k) => {
    const row = [...document.querySelectorAll('.rt-habit-row')].find(r => /Stretch/.test(r.textContent));
    return [...row.querySelectorAll('.rt-habit-strip span')].map(s => ({ cls: s.className, title: s.title }));
  }, sun);
  const sunDot = stripInfo.find(s => s.title.startsWith(sun));
  const satDot = stripInfo.find(s => s.title.startsWith(sat));
  const monDot = stripInfo.find(s => s.title.startsWith(mon));
  check('the strip\'s Sunday dot is classed "miss"', sunDot && sunDot.cls === 'miss', JSON.stringify(sunDot));
  check('the strip\'s Saturday dot is classed "miss"', satDot && satDot.cls === 'miss', JSON.stringify(satDot));
  check('the strip\'s Monday dot is classed "on" (it was actually done)', monDot && monDot.cls === 'on', JSON.stringify(monDot));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
