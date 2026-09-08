/* The Overview week label is now clickable - it opens a modal listing
   every week ever logged (from historyRows_, the same cross-week rollup
   the History tab's own charts already read), newest first, tapping one
   shows that week's full day-by-day exercise breakdown - not just the
   pushup-only summary the older weekDetailModalOverlay shows. */
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

  console.log('=== Seed two past weeks of history, plus today\'s current week ===');
  await page.evaluate(() => {
    const rows = [
      // Older week first in the array, on purpose - the list must sort by
      // date, not by array/insertion order.
      { date: '2026-08-17', day: 'Monday', exercise: 'Pushups', sets: 3, done: 3, topWeight: 0, volume: 0, targetReps: '55', totalReps: 165, green: 3, yellow: 0, red: 0, week: 'Week of Aug 17 - Aug 23, 2026', topSetReps: 55, bestSetVolume: 0, est1RM: 0 },
      { date: '2026-08-18', day: 'Tuesday', exercise: 'Leg Press', sets: 3, done: 3, topWeight: 245, volume: 7350, targetReps: '10', totalReps: 30, green: 2, yellow: 1, red: 0, week: 'Week of Aug 17 - Aug 23, 2026', topSetReps: 10, bestSetVolume: 2450, est1RM: 320 },
      { date: '2026-08-24', day: 'Monday', exercise: 'Pushups', sets: 3, done: 3, topWeight: 0, volume: 0, targetReps: '55', totalReps: 165, green: 3, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026', topSetReps: 55, bestSetVolume: 0, est1RM: 0 },
      { date: '2026-08-25', day: 'Tuesday', exercise: 'Leg Press', sets: 3, done: 3, topWeight: 250, volume: 7500, targetReps: '10', totalReps: 30, green: 3, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026', topSetReps: 10, bestSetVolume: 2500, est1RM: 328 }
    ];
    localStorage.setItem('WORKOUT_HISTORY_CACHE', JSON.stringify({ rows, at: new Date().toISOString() }));
  });

  console.log('\n=== Clicking the week label opens the picker ===');
  await page.evaluate(() => showAppView('overview'));
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('ovWeekLabel').click());
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => ({
    isOpen: document.getElementById('weekHistoryModalOverlay').classList.contains('open'),
    title: document.getElementById('whModalTitle').textContent,
    backHidden: document.getElementById('whBackBtn').style.display === 'none'
  }));
  check('the modal opens', opened.isOpen);
  check('starts on the week picker, not a specific week', opened.title === 'Select a week', opened.title);
  check('the back button is hidden on the list view', opened.backHidden);

  console.log('\n=== The two seeded weeks are listed, newest first ===');
  const list = await page.evaluate(() => [...document.querySelectorAll('#whWeekList .wh-week-label')].map(el => el.textContent));
  check('both weeks appear, Aug 24 before Aug 17', list.length === 2 && list[0].startsWith('Week of Aug 24') && list[1].startsWith('Week of Aug 17'), JSON.stringify(list));

  console.log('\n=== Selecting a week shows its day-by-day breakdown ===');
  await page.evaluate(() => {
    [...document.querySelectorAll('#whWeekList .wh-week-row')].find(r => r.dataset.week.startsWith('Week of Aug 17')).click();
  });
  await page.waitForTimeout(150);
  const detail = await page.evaluate(() => ({
    title: document.getElementById('whModalTitle').textContent,
    backVisible: document.getElementById('whBackBtn').style.display !== 'none',
    listHidden: document.getElementById('whWeekList').style.display === 'none',
    dayLabels: [...document.querySelectorAll('#whWeekDetail .wh-day-label')].map(el => el.textContent),
    exerciseNames: [...document.querySelectorAll('#whWeekDetail .wh-ex-name')].map(el => el.textContent),
    legPressMeta: [...document.querySelectorAll('#whWeekDetail .wh-ex-row')].find(row => row.querySelector('.wh-ex-name').textContent === 'Leg Press').querySelector('.wh-ex-meta').textContent
  }));
  check('the title switches to the selected week', detail.title === 'Week of Aug 17 - Aug 23, 2026', detail.title);
  check('the back button appears', detail.backVisible);
  check('the week list hides', detail.listHidden);
  check('both logged days appear, in date order', detail.dayLabels.length === 2 && detail.dayLabels[0].includes('Monday') && detail.dayLabels[1].includes('Tuesday'), JSON.stringify(detail.dayLabels));
  check('both exercises from that week appear', detail.exerciseNames.includes('Pushups') && detail.exerciseNames.includes('Leg Press'), JSON.stringify(detail.exerciseNames));
  check('the exercise detail carries real numbers (sets, reps, weight, quality)', /3\/3 sets.*30 reps.*top 245 lb.*2 good, 1 tough/.test(detail.legPressMeta), detail.legPressMeta);

  console.log('\n=== The back button returns to the week list ===');
  await page.evaluate(() => document.getElementById('whBackBtn').click());
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => ({
    title: document.getElementById('whModalTitle').textContent,
    listVisible: document.getElementById('whWeekList').style.display !== 'none'
  }));
  check('back returns to the week picker', back.title === 'Select a week' && back.listVisible, JSON.stringify(back));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
