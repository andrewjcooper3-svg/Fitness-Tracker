// The History tab, laid out the way Hevy lays it out: Overview / Exercises
// / Workouts, a range that applies to the whole tab, an exercise list that
// drills into records + charts, and a feed of workout cards.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve('/home/user/Fitness-Tracker/Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

// Six weeks shaped like the real log: Leg Press climbing clean, Cable
// Crunch going red, Plank never finished, Pushups on reps only. Plus one
// old session well outside 3M, to prove the range chips actually filter.
function history() {
  const rows = [];
  const weeks = [
    ['2026-07-13', 'Week of Jul 13 - Jul 19, 2026'],
    ['2026-07-20', 'Week of Jul 20 - Jul 26, 2026'],
    ['2026-07-27', 'Week of Jul 27 - Aug 2, 2026'],
    ['2026-08-03', 'Week of Aug 3 - Aug 9, 2026'],
    ['2026-08-10', 'Week of Aug 10 - Aug 16, 2026'],
    ['2026-08-17', 'Week of Aug 17 - Aug 23, 2026']
  ];
  const epley = (w, r) => w * (1 + r / 30);
  weeks.forEach(([monday, week], i) => {
    const lp = 225 + i * 5;                       // climbing, clean
    rows.push({ date: monday, day: 'Monday', exercise: 'Leg Press', sets: 3, done: 3,
      topWeight: lp, topSetReps: 10, volume: lp * 30, bestSetVolume: lp * 10,
      est1RM: epley(lp, 10), targetReps: 10, totalReps: 30, green: 3, yellow: 0, red: 0, week });
    // Cable Crunch: stuck at 70 and going red in the last three weeks.
    rows.push({ date: monday, day: 'Monday', exercise: 'Cable Crunch', sets: 3, done: 3,
      topWeight: 70, topSetReps: 15, volume: 70 * 45, bestSetVolume: 70 * 15,
      est1RM: epley(70, 15), targetReps: 15, totalReps: 45,
      green: i < 3 ? 3 : 0, yellow: 0, red: i < 3 ? 0 : 3, week });
    // Plank: planned every week, barely done.
    rows.push({ date: monday, day: 'Monday', exercise: 'Plank', sets: 3, done: 0,
      topWeight: 0, topSetReps: 0, volume: 0, bestSetVolume: 0, est1RM: 0,
      targetReps: '60s', totalReps: 0, green: 0, yellow: 0, red: 0, week });
    // Pushups, bodyweight - reps only, no weight to plot.
    rows.push({ date: monday, day: 'Monday', exercise: 'Pushups', sets: 3, done: 3,
      topWeight: 0, topSetReps: 0, volume: 0, bestSetVolume: 0, est1RM: 0,
      targetReps: 55, totalReps: 165, green: 2, yellow: 1, red: 0, week });
    // A second day in the week.
    const wed = new Date(monday + 'T00:00:00'); wed.setDate(wed.getDate() + 2);
    const lat = 90 + i * 5;
    rows.push({ date: wed.toISOString().slice(0, 10), day: 'Wednesday', exercise: 'Lat Pulldown',
      sets: 3, done: 3, topWeight: lat, topSetReps: 10, volume: lat * 30, bestSetVolume: lat * 10,
      est1RM: epley(lat, 10), targetReps: 10, totalReps: 30, green: 3, yellow: 0, red: 0, week });
  });
  // Ancient history: only visible on "All".
  rows.push({ date: '2025-01-06', day: 'Monday', exercise: 'Leg Press', sets: 3, done: 3,
    topWeight: 135, topSetReps: 10, volume: 4050, bestSetVolume: 1350, est1RM: epley(135, 10),
    targetReps: 10, totalReps: 30, green: 3, yellow: 0, red: 0, week: 'Week of Jan 6 - Jan 12, 2025' });
  return rows;
}

const mock = rows => route => {
  const req = route.request();
  const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (req.url().includes('action=loadWorkoutHistory')) return J({ status: 'success', history: rows });
  if (req.method() === 'POST') return J({ status: 'success' });
  return J({ status: 'error' });
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const rows = history();

  for (const [w, h, tag] of [[430, 932, 'portrait'], [932, 430, 'landscape'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', mock(rows));
    await page.goto(URL);
    // The absorbed Pushups and Weight cards read local storage, so seed both
    // - an empty weight log collapses that chart and it would go untested.
    await page.evaluate(() => {
      const log = [], ledger = {};
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.now() - i * 3 * 86400000);
        log.push({ date: d.toISOString().slice(0, 10), weight: 186 - i * 0.4 + (i % 3) * 0.6, bodyFat: i % 4 ? null : 17.2 });
      }
      for (let i = 0; i < 56; i++) {
        const d = new Date(Date.now() - i * 86400000);
        if (i % 7 !== 6) ledger[d.toISOString().slice(0, 10)] = 120 + (i * 37) % 90;
      }
      localStorage.setItem('WORKOUT_WEIGHT_LOG', JSON.stringify(log));
      localStorage.setItem('WORKOUT_PUSHUP_LEDGER', JSON.stringify(ledger));
    });
    await page.reload();
    await page.waitForTimeout(1000);
    await page.evaluate(() => showAppView('stats'));
    await page.waitForTimeout(1500);

    if (tag === 'portrait') {
      const tabLabel = await page.evaluate(() =>
        document.querySelector('.app-tab[data-view="stats"] .app-tab-label').textContent);
      check('tab is called History', tabLabel === 'History', tabLabel);

      console.log('\n  -- Overview --');
      const tiles = await page.evaluate(() =>
        [...document.querySelectorAll('#hxTiles > div')].map(d => d.innerText.replace(/\s+/g, ' ').trim()));
      console.log('   tiles:', tiles.join(' | '));
      check('four summary tiles', tiles.length === 4, String(tiles.length));
      check('workouts tile counts distinct days', /^13 workouts$/i.test(tiles[0]), tiles[0]);
      check('volume tile is abbreviated, not raw', /k lb volume$/i.test(tiles[1]), tiles[1]);

      const muscles = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('#hxMuscles .hx-muscle')].map(m => m.innerText.replace(/\s+/g, ' ').trim()),
        note: document.getElementById('hxMuscleNote').textContent
      }));
      muscles.rows.forEach(m => console.log('   ', m));
      console.log('   note:', muscles.note);
      check('muscle groups ranked by sets', muscles.rows.length >= 3, String(muscles.rows.length));
      check('quads picked up Leg Press', muscles.rows.some(m => /^Quads/.test(m)), muscles.rows.join(' | '));
      check('back picked up Lat Pulldown', muscles.rows.some(m => /^Back/.test(m)), muscles.rows.join(' | '));
      check('chest picked up Pushups', muscles.rows.some(m => /^Chest/.test(m)), muscles.rows.join(' | '));
      check('the note totals the sets', /\d+ completed sets in this range/.test(muscles.note), muscles.note);
      // An inline span ignores width; the bars must actually be drawn.
      const fills = await page.evaluate(() =>
        [...document.querySelectorAll('#hxMuscles .hx-muscle-fill')].map(f => Math.round(f.getBoundingClientRect().width)));
      console.log('   fill widths:', fills.join(', '));
      check('the top group\'s bar fills its track', fills[0] > 100, String(fills[0]));
      check('bars shrink down the ranking', fills.every((w, i) => i === 0 || w <= fills[i - 1]) && fills[fills.length - 1] > 0,
        fills.join(','));

      const stalling = await page.evaluate(() =>
        [...document.querySelectorAll('#hxStalling .hx-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
      stalling.forEach(t => console.log('   ', t));
      check('Cable Crunch flagged for reds', stalling.some(t => /Cable Crunch.*too tough/i.test(t)), stalling.join(' | '));
      check('Plank flagged for unfinished sets', stalling.some(t => /Plank.*not finished/i.test(t)), stalling.join(' | '));
      check('Leg Press is NOT flagged (it is progressing)', !stalling.some(t => /Leg Press/.test(t)));

      const bars = await page.evaluate(() => ({
        freq: document.querySelectorAll('#hxFreqChart rect').length,
        volume: document.querySelectorAll('#hxVolumeChart rect').length,
        completion: document.querySelectorAll('#hxCompletionChart rect').length
      }));
      console.log('   charts:', JSON.stringify(bars));
      check('workouts-per-week chart drew', bars.freq >= 6 * 2, String(bars.freq));
      check('volume chart drew', bars.volume >= 6 * 2, String(bars.volume));
      check('completion chart drew', bars.completion >= 6 * 2, String(bars.completion));
      const details = await page.evaluate(() => ({
        freq: document.getElementById('hxFreqDetail').textContent,
        vol: document.getElementById('hxVolumeDetail').textContent,
        comp: document.getElementById('hxCompletionDetail').textContent
      }));
      check('no stale "no sessions" line under a filled chart',
        !Object.values(details).some(t => /No sessions/.test(t)), JSON.stringify(details));

      await page.evaluate(() => showHistoryWeekDetail('hxVolumeDetail', 'Week of Aug 17 - Aug 23, 2026'));
      const detail = await page.evaluate(() => document.getElementById('hxVolumeDetail').textContent);
      console.log('   week detail:', detail);
      check('week detail reports volume and sets', /lb volume · \d+\/\d+ sets · 2 days/.test(detail), detail);

      console.log('\n  -- Range chips filter the whole tab --');
      await page.evaluate(() => setHistoryRange(90));
      await page.waitForTimeout(400);
      const ranged = await page.evaluate(() => ({
        tiles: document.querySelector('#hxTiles > div').innerText.replace(/\s+/g, ' ').trim(),
        active: document.querySelector('#hxRange .hx-range-btn.active').textContent
      }));
      console.log('   3M:', JSON.stringify(ranged));
      check('3M drops the 2025 session', /^12 workouts$/i.test(ranged.tiles), ranged.tiles);
      check('the 3M chip is the active one', ranged.active === '3M', ranged.active);
      const persisted = await page.evaluate(() => localStorage.getItem('WORKOUT_HISTORY_RANGE'));
      check('the range is remembered', persisted === '90', String(persisted));
      await page.evaluate(() => setHistoryRange(0));
      await page.waitForTimeout(300);

      console.log('\n  -- Exercises --');
      await page.evaluate(() => showHistorySection('exercises'));
      await page.waitForTimeout(500);
      const list = await page.evaluate(() =>
        [...document.querySelectorAll('#hxExerciseList .hx-ex-item')].map(e => e.innerText.replace(/\s+/g, ' ').trim()));
      list.forEach(l => console.log('   ', l));
      check('every exercise is listed', list.length === 5, String(list.length));
      check('rows carry a session count and a last date', /\d+ sessions · last \w+ \d+/.test(list[0]), list[0]);

      const filtered = await page.evaluate(() => {
        const s = document.getElementById('hxExerciseSearch');
        s.value = 'press'; renderHistoryExerciseList();
        return [...document.querySelectorAll('#hxExerciseList .hx-ex-item')].map(e => e.innerText.split('\n')[0]);
      });
      console.log('   search "press":', filtered.join(', '));
      check('search narrows the list', filtered.length === 1 && /Leg Press/.test(filtered[0]), filtered.join(','));
      await page.evaluate(() => { document.getElementById('hxExerciseSearch').value = ''; renderHistoryExerciseList(); });

      console.log('\n  -- One exercise: records + chart + history --');
      await page.evaluate(() => openHistoryExercise('Leg Press'));
      await page.waitForTimeout(500);
      const ex = await page.evaluate(() => ({
        listHidden: document.getElementById('hxExerciseListCard').style.display === 'none',
        name: document.getElementById('hxExerciseName').textContent,
        records: [...document.querySelectorAll('#hxRecords .hx-rec')].map(r => r.innerText.replace(/\s+/g, ' ').trim()),
        summary: document.getElementById('hxExerciseSummary').textContent,
        rows: [...document.querySelectorAll('#hxExerciseRows .hx-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim())
      }));
      console.log('   name:', ex.name);
      ex.records.forEach(r => console.log('    rec:', r));
      console.log('   summary:', ex.summary);
      ex.rows.slice(0, 2).forEach(r => console.log('   ', r));
      check('the list gives way to the detail view', ex.listHidden && ex.name === 'Leg Press');
      check('records include the heaviest weight with its reps',
        ex.records.some(r => /Heaviest weight 250 lb × 10/.test(r)), ex.records.join(' | '));
      check('records include an estimated 1RM',
        ex.records.some(r => /Best est\. 1RM 333 lb/.test(r)), ex.records.join(' | '));
      check('records include best set volume',
        ex.records.some(r => /Best set volume 2,500 lb/.test(r)), ex.records.join(' | '));
      check('summary shows the progression', /135 lb → 250 lb \(\+115\)/.test(ex.summary), ex.summary);
      check('newest session first', /Aug 17/.test(ex.rows[0]), ex.rows[0]);
      check('per-session delta shown', /▲ \+5/.test(ex.rows[0]), ex.rows[0]);
      check('the best-ever session is starred', /★/.test(ex.rows[0]), ex.rows[0]);

      // Records are all-time, so the 2025 session must not erase them, and
      // narrowing the range must not change them either.
      await page.evaluate(() => setHistoryRange(90));
      await page.waitForTimeout(400);
      const stillPR = await page.evaluate(() =>
        [...document.querySelectorAll('#hxRecords .hx-rec')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
      check('records survive a range change (a PR is all-time)',
        stillPR.some(r => /Heaviest weight 250 lb/.test(r)), stillPR.join(' | '));
      await page.evaluate(() => setHistoryRange(0));
      await page.waitForTimeout(300);

      const metric = await page.evaluate(() => {
        const p = document.getElementById('hxMetricPicker');
        p.value = 'est1RM'; renderHistoryExercise();
        return document.getElementById('hxExerciseSummary').textContent;
      });
      console.log('   est1RM view:', metric);
      check('the metric picker re-plots the chart', /estimated 1rm 180 lb → 333 lb/i.test(metric), metric);

      // Bodyweight work has no weight to plot; the picker must not offer it.
      await page.evaluate(() => openHistoryExercise('Pushups'));
      await page.waitForTimeout(400);
      const pu = await page.evaluate(() => ({
        summary: document.getElementById('hxExerciseSummary').textContent,
        visible: [...document.getElementById('hxMetricPicker').options].filter(o => !o.hidden).map(o => o.value),
        records: [...document.querySelectorAll('#hxRecords .hx-rec')].map(r => r.innerText.replace(/\s+/g, ' ').trim())
      }));
      console.log('   pushups:', JSON.stringify(pu));
      check('bodyweight charts reps, not weight', /reps 165 → 165/.test(pu.summary), pu.summary);
      check('no weight metrics offered for bodyweight work',
        pu.visible.length === 1 && pu.visible[0] === 'totalReps', pu.visible.join(','));
      check('bodyweight records are rep records',
        pu.records.every(r => !/lb/.test(r)) && pu.records.length === 2, pu.records.join(' | '));

      // The progression is a line now; the dots keep the quality channel, so
      // a red session must still show up as a red dot.
      await page.evaluate(() => openHistoryExercise('Cable Crunch'));
      await page.waitForTimeout(400);
      const cc = await page.evaluate(() => ({
        dots: [...document.querySelectorAll('#hxExerciseChart .chart-dot')].map(c => c.getAttribute('fill')),
        line: document.querySelectorAll('#hxExerciseChart .chart-line').length,
        area: document.querySelectorAll('#hxExerciseChart .chart-area').length
      }));
      console.log('   dots:', cc.dots.join(', '));
      check('a progression is drawn as a line, not bars', cc.line === 1 && cc.area === 1, JSON.stringify(cc));
      check('red sessions are red dots', cc.dots.filter(f => f === 'var(--red)').length === 3, cc.dots.join(','));

      await page.evaluate(() => closeHistoryExercise());
      await page.waitForTimeout(300);
      check('back returns to the list', await page.evaluate(() =>
        document.getElementById('hxExerciseListCard').style.display !== 'none'
        && document.getElementById('hxExerciseDetailWrap').style.display === 'none'));

      console.log('\n  -- Workouts feed --');
      await page.evaluate(() => showHistorySection('workouts'));
      await page.waitForTimeout(400);
      const wk = await page.evaluate(() => ({
        count: document.querySelectorAll('#hxDayList .hx-wk').length,
        first: document.querySelector('#hxDayList .hx-wk').innerText.replace(/\s+/g, ' ').trim(),
        stats: [...document.querySelectorAll('#hxDayList .hx-wk:first-child .hx-wk-stat-label')].map(s => s.textContent)
      }));
      console.log('   cards:', wk.count);
      console.log('   first:', wk.first);
      check('one card per session, newest first', wk.count === 13 && /August 19/.test(wk.first),
        `${wk.count} ${wk.first.slice(0, 60)}`);
      check('cards carry volume / sets / exercises', wk.stats.join(',') === 'Volume lb,Sets,Exercises', wk.stats.join(','));
      check('exercise lines read "N × Name"', /\d+ × Lat Pulldown/.test(wk.first), wk.first.slice(0, 120));

      // Tapping an exercise on a card jumps to that exercise.
      await page.evaluate(() => document.querySelector('#hxDayList .hx-wk-ex').click());
      await page.waitForTimeout(500);
      check('tapping a card exercise opens it', await page.evaluate(() =>
        document.getElementById('hxExerciseName').textContent === 'Lat Pulldown'
        && document.getElementById('hxSectionExercises').style.display !== 'none'));
      await page.evaluate(() => { closeHistoryExercise(); showHistorySection('overview'); });
      await page.waitForTimeout(300);

      console.log('\n  -- A planned day that never happened is not a 0 --');
      // Plank is planned 3 sets every week in the fixture and completed
      // none of them, so it is the pure case.
      await page.evaluate(() => openHistoryExercise('Plank'));
      await page.waitForTimeout(500);
      const plank = await page.evaluate(() => ({
        summary: document.getElementById('hxExerciseSummary').textContent,
        chartMarks: document.querySelectorAll('#hxExerciseChart .chart-dot').length,
        rows: [...document.querySelectorAll('#hxExerciseRows .hx-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()),
        skippedRows: document.querySelectorAll('#hxExerciseRows .hx-row-skipped').length
      }));
      console.log('   summary:', plank.summary);
      console.log('   first row:', plank.rows[0]);
      check('a never-completed exercise plots nothing at all', plank.chartMarks === 0, String(plank.chartMarks));
      check('and says so rather than charting a flat zero',
        /never completed/i.test(plank.summary), plank.summary);
      check('but the planned days are still listed', plank.rows.length === 6, String(plank.rows.length));
      check('each marked as not completed', /not completed/.test(plank.rows[0]), plank.rows[0]);

      // Mixed case: an exercise that mostly happened, with one skipped day.
      await page.evaluate(() => {
        // Blank out the most recent Leg Press session in place.
        const r = historyRows_.filter(x => x.exercise === 'Leg Press').sort((a, b) => a.date.localeCompare(b.date)).pop();
        r.done = 0; r.totalReps = 0; r.topWeight = 0; r.volume = 0;
        r.est1RM = 0; r.bestSetVolume = 0; r.green = 0; r.yellow = 0; r.red = 0;
        openHistoryExercise('Leg Press');
        // The picker is sticky across exercises; put it back on weight so
        // this checks the weight trend rather than reps.
        document.getElementById('hxMetricPicker').value = 'topWeight';
        renderHistoryExercise();
      });
      await page.waitForTimeout(500);
      const mixed = await page.evaluate(() => ({
        summary: document.getElementById('hxExerciseSummary').textContent,
        dots: document.querySelectorAll('#hxExerciseChart .chart-dot').length,
        rows: [...document.querySelectorAll('#hxExerciseRows .hx-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()),
        skipped: document.querySelectorAll('#hxExerciseRows .hx-row-skipped').length,
        low: Math.min(...[...document.querySelectorAll('#hxExerciseChart .chart-dot')].map(c => +c.getAttribute('cy')))
      }));
      console.log('   summary:', mixed.summary);
      console.log('   rows:', mixed.rows.slice(0, 2).join(' | '));
      check('the skipped day is left off the chart', mixed.dots === 6, String(mixed.dots));
      check('the trend says how many it left off',
        /1 planned day not completed, left off the chart/.test(mixed.summary), mixed.summary);
      check('the trend still ends on the last real session',
        /135 lb → 245 lb/.test(mixed.summary), mixed.summary);
      check('the skipped day is still in the list', mixed.skipped === 1, String(mixed.skipped));
      check('and carries no delta arrow', !/▼|▲/.test(mixed.rows[0]), mixed.rows[0]);
      // The delta below it must compare to the last day that actually
      // happened, not to a phantom zero.
      check('the next row down is not a crash from zero', !/\+245|\+250/.test(mixed.rows[1] || ''), mixed.rows[1]);

      await page.evaluate(() => { closeHistoryExercise(); showHistorySection('overview'); loadWorkoutHistory(true); });
      await page.waitForTimeout(1200);

      console.log('\n  -- Muscle groups are auditable --');
      const drill = await page.evaluate(() => {
        toggleHistoryMuscle('Chest');
        return {
          rows: [...document.querySelectorAll('#hxMuscles .hx-muscle-ex > div')].map(d => d.innerText.replace(/\s+/g, ' ').trim()),
          title: document.querySelector('#hxMuscles .hx-muscle').getAttribute('title'),
          note: document.getElementById('hxMuscleNote').textContent
        };
      });
      console.log('   chest breakdown:', drill.rows.join(' | '));
      check('a group opens to the exercises behind it',
        drill.rows.length >= 1 && /Pushups \d+ sets/.test(drill.rows.join(' ')), drill.rows.join(' | '));
      check('and every row carries the same as hover text', !!drill.title, String(drill.title));
      check('the note invites the drill-down', /tap a group/i.test(drill.note), drill.note);
      await page.evaluate(() => toggleHistoryMuscle('Chest'));

      console.log('\n  -- Chart engine --');
      // The NaN class of bug: one formatter returning a number instead of a
      // string made the gutter NaN, and every mark landed on x=NaN - the
      // whole chart collapsed into a smear at the left edge and still
      // "rendered". Scan the markup, and check the marks actually spread.
      const chartIds = ['hxFreqChart', 'hxVolumeChart', 'hxCompletionChart', 'statsPushupChart', 'statsWeightChart'];
      const probe = await page.evaluate(ids => ids.map(id => {
        const svg = document.getElementById(id);
        if (!svg) return { id, missing: true };
        const w = Math.round(svg.getBoundingClientRect().width);
        const xs = [...svg.querySelectorAll('.chart-hit')].map(r => +r.getAttribute('x'));
        const bars = [...svg.querySelectorAll('path[fill]')].filter(p => !p.classList.contains('chart-area') && !p.classList.contains('chart-line'));
        const barW = [...svg.querySelectorAll('rect.chart-hit')].map(r => +r.getAttribute('width'));
        return {
          id, w,
          nan: /NaN|undefined/.test(svg.innerHTML),
          marks: xs.length,
          spread: xs.length ? Math.round(Math.max(...xs) - Math.min(...xs)) : 0,
          grid: svg.querySelectorAll('.chart-grid').length,
          ticks: [...svg.querySelectorAll('.chart-tick')].map(t => t.textContent),
          values: svg.querySelectorAll('.chart-value').length,
          bandW: barW.length ? Math.round(Math.min(...barW)) : 0,
          bars: bars.length
        };
      }), chartIds);

      probe.forEach(c => {
        console.log(`   ${c.id}: ${c.w}px · ${c.marks} marks spread ${c.spread}px · ${c.grid} gridlines · ${c.values} labels`);
        check(`${c.id} emitted no NaN`, !c.nan);
        check(`${c.id} spreads its marks across the plot`, c.marks >= 2 && c.spread > c.w * 0.4,
          `spread ${c.spread} of ${c.w}px`);
        check(`${c.id} drew a gridded axis`, c.grid >= 2 && c.ticks.length > c.grid, `${c.grid} lines, ${c.ticks.length} ticks`);
        // Selective labels: a number over every column is the anti-pattern.
        check(`${c.id} labels selectively`, c.values <= Math.max(2, Math.ceil(c.marks / 3)),
          `${c.values} labels for ${c.marks} marks`);
      });

      // Ticks land on round numbers, and columns stay thin.
      const vol = probe.find(c => c.id === 'hxVolumeChart');
      console.log('   volume ticks:', vol.ticks.slice(0, 5).join(' '));
      check('y ticks are round numbers', vol.ticks.slice(0, 4).every(t => /^\d+(\.\d)?k?$/.test(t)), vol.ticks.slice(0, 4).join(','));

      const thick = await page.evaluate(() => {
        const paths = [...document.querySelectorAll('#hxVolumeChart path[fill]')];
        return paths.map(p => {
          const b = p.getBBox();
          return Math.round(b.width);
        });
      });
      console.log('   column widths:', thick.join(', '));
      check('columns are capped at 24px, not filling the slot', Math.max(...thick) <= 24, thick.join(','));

      // Hover must produce a tooltip, and must not be the only way to read
      // the value - the detail line takes it too.
      await page.hover('#hxVolumeChart .chart-hit');
      await page.waitForTimeout(200);
      const tip = await page.evaluate(() => {
        const t = document.querySelector('.chart-tip');
        return { on: !!t && t.classList.contains('on'), text: t ? t.innerText.replace(/\s+/g, ' ').trim() : '',
                 detail: document.getElementById('hxVolumeDetail').textContent };
      });
      console.log('   tooltip:', JSON.stringify(tip.text), '| detail:', JSON.stringify(tip.detail));
      check('hovering a column shows a tooltip', tip.on && /day|sets|volume/i.test(tip.text), tip.text);
      check('the same numbers reach the detail line', /lb volume/.test(tip.detail), tip.detail);

      // Status colour is never the only channel.
      const qmix = await page.evaluate(() => {
        const el = document.querySelector('#hxDayList .hx-qmix, .hx-qmix');
        return el ? el.getAttribute('title') : null;
      });

      console.log('\n  -- Stats cards still there --');
      const kept = await page.evaluate(() => ({
        pushup: !!document.getElementById('statsPushupChart'),
        weight: !!document.getElementById('statsWeightChart')
      }));
      check('pushup + weight cards absorbed, not lost', kept.pushup && kept.weight, JSON.stringify(kept));
    }

    if (tag === 'landscape') {
      // A phone on its side is only 430px tall, so wasted vertical space
      // costs the most here.
      const cols = await page.evaluate(() =>
        [...document.querySelectorAll('#hxSectionOverview > .stats-card')].map(c => {
          const r = c.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) };
        }));
      const lefts = [...new Set(cols.map(c => c.left))].sort((a, b) => a - b);
      check('landscape runs two columns', lefts.length === 2, lefts.join(','));
      const gaps = lefts.map(x => {
        const col = cols.filter(c => c.left === x).sort((a, b) => a.top - b.top);
        return Math.max(0, ...col.slice(1).map((c, i) => c.top - col[i].bottom));
      });
      console.log('  worst gap per column:', gaps.join(', '));
      check('no dead space between stacked cards', Math.max(...gaps) <= 14, gaps.join(','));
      const bottoms = lefts.map(x => Math.max(...cols.filter(c => c.left === x).map(c => c.bottom)));
      console.log('  column bottoms:', bottoms.join(', '));
      check('the two columns end at a similar depth',
        Math.abs(bottoms[0] - bottoms[1]) < 320, bottoms.join(','));
      const seg = await page.evaluate(() => Math.round(document.getElementById('hxSeg').getBoundingClientRect().width));
      check('the segmented control stays a menu here too', seg <= 470, String(seg));
    }

    if (tag === 'desktop') {
      const cols = await page.evaluate(() =>
        [...document.querySelectorAll('#hxSectionOverview > .stats-card')].map(c => {
          const r = c.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom),
                   left: Math.round(r.left), w: Math.round(r.width) };
        }));
      console.log('  overview cards:', JSON.stringify(cols.map(c => `${c.left},${c.top}-${c.bottom}`)));
      const lefts = [...new Set(cols.map(c => c.left))].sort((a, b) => a - b);
      check('overview runs three columns at 1400px', lefts.length === 3, lefts.join(','));
      check('the absorbed Pushups and Weight cards joined the flow',
        cols.length === 8, String(cols.length));

      // The complaint that started this: a grid row is as tall as its
      // tallest card, so a short one leaves a hole. Packed columns must not.
      const gaps = lefts.map(x => {
        const col = cols.filter(c => c.left === x).sort((a, b) => a.top - b.top);
        return Math.max(0, ...col.slice(1).map((c, i) => c.top - col[i].bottom));
      });
      console.log('  worst gap per column:', gaps.join(', '));
      check('no dead space between stacked cards', Math.max(...gaps) <= 14, gaps.join(','));

      // And the columns should finish at roughly the same depth.
      const bottoms = lefts.map(x => Math.max(...cols.filter(c => c.left === x).map(c => c.bottom)));
      const ragged = Math.max(...bottoms) - Math.min(...bottoms);
      console.log('  column bottoms:', bottoms.join(', '), '| ragged by', ragged);
      check('the columns end at a similar depth', ragged < 320, String(ragged));

      const seg = await page.evaluate(() => Math.round(document.getElementById('hxSeg').getBoundingClientRect().width));
      console.log('  segmented control:', seg + 'px');
      check('the segmented control is a menu, not a full-width banner', seg <= 470, String(seg));

      const tileCols = await page.evaluate(() =>
        [...new Set([...document.querySelectorAll('#hxTiles > div')].map(d => Math.round(d.getBoundingClientRect().left)))].length);
      check('the four tiles sit on one row', tileCols === 4, String(tileCols));
      const scale = await page.evaluate(() => {
        const svg = document.getElementById('hxVolumeChart');
        const m = svg.getScreenCTM();
        return { x: Math.round(m.a * 1000) / 1000, y: Math.round(m.d * 1000) / 1000 };
      });
      console.log('  chart scale:', JSON.stringify(scale));

      // The feed and the exercise detail are each a single child of their
      // section, so without their own grid they'd sit in one column with
      // the other half of the screen blank.
      await page.evaluate(() => showHistorySection('workouts'));
      await page.waitForTimeout(400);
      const feed = await page.evaluate(() =>
        [...document.querySelectorAll('#hxDayList .hx-wk')].map(c => {
          const r = c.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) };
        }));
      const feedCols = [...new Set(feed.map(c => c.left))].sort((a, b) => a - b);
      console.log('  feed columns:', feedCols.join(', '), '| cards', feed.length);
      check('the workouts feed runs three columns on desktop', feedCols.length === 3, feedCols.join(','));
      const feedGaps = feedCols.map(x => {
        const col = feed.filter(c => c.left === x).sort((a, b) => a.top - b.top);
        return Math.max(0, ...col.slice(1).map((c, i) => c.top - col[i].bottom));
      });
      console.log('  worst feed gap per column:', feedGaps.join(', '));
      check('the feed cards pack against each other', Math.max(...feedGaps) <= 14, feedGaps.join(','));
      const legacyHidden = await page.evaluate(() => {
        const pu = document.getElementById('statsPushupChart');
        return { chartVisible: !!(pu && pu.getBoundingClientRect().height),
                 noteShown: document.getElementById('hxLegacyNote').style.display !== 'none' };
      });
      check('Pushups and Weight do not follow you onto Workouts',
        !legacyHidden.chartVisible && !legacyHidden.noteShown, JSON.stringify(legacyHidden));

      await page.evaluate(() => { showHistorySection('exercises'); openHistoryExercise('Leg Press'); });
      await page.waitForTimeout(500);
      const det = await page.evaluate(() =>
        [...document.querySelectorAll('#hxExerciseDetailWrap > .stats-card')].map(c => {
          const r = c.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) };
        }));
      console.log('  detail cards:', JSON.stringify(det));
      check('the exercise header spans the full width', det[0].w > det[1].w + 100,
        `${det[0].w} vs ${det[1].w}`);
      const rowCols = await page.evaluate(() =>
        [...new Set([...document.querySelectorAll('#hxExerciseRows > .hx-row')]
          .map(r => Math.round(r.getBoundingClientRect().left)))].length);
      console.log('  session-list columns:', rowCols);
      check('the session list splits rather than stranding each value', rowCols === 2, String(rowCols));
      check('records and charts sit side by side',
        Math.abs(det[1].top - det[2].top) < 4 && det[1].left !== det[2].left, JSON.stringify(det.slice(1, 3)));
      await page.evaluate(() => { closeHistoryExercise(); showHistorySection('overview'); });
      await page.waitForTimeout(300);
      check('history charts draw 1:1, not stretched',
        Math.abs(scale.x - 1) < 0.02 && Math.abs(scale.x - scale.y) < 0.02, JSON.stringify(scale));
    }

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`${tag}: no horizontal overflow`, !overflow);
    await page.evaluate(() => showHistorySection('overview'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `hx_${tag}.png`, fullPage: tag === 'portrait' });
    await ctx.close();
  }

  console.log('\n=== Empty and error states ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', route => {
      const req = route.request();
      const J = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      // A deployment that predates the endpoint answers with its status page.
      if (req.url().includes('action=loadWorkoutHistory')) return J({ status: 'ok', backendVersion: '2026-08-22-widget-summary' });
      if (req.method() === 'POST') return J({ status: 'success' });
      return J({ status: 'error' });
    });
    await page.goto(URL);
    await page.waitForTimeout(1000);
    await page.evaluate(() => showAppView('stats'));
    await page.waitForTimeout(1500);
    const status = await page.evaluate(() => document.getElementById('hxStatus').textContent);
    console.log('  status:', status);
    check('a stale deployment says so', /no history endpoint yet.*redeploy/i.test(status), status);
    const empty = await page.evaluate(() => ({
      stalling: document.getElementById('hxStalling').textContent,
      muscles: document.getElementById('hxMuscles').textContent,
      tiles: document.getElementById('hxTiles').innerText.replace(/\s+/g, ' ').trim()
    }));
    console.log('  empty:', JSON.stringify(empty));
    check('empty state is a sentence, not a blank card', /Nothing stalling/.test(empty.stalling), empty.stalling);
    check('muscle card explains itself when empty', /No completed sets/.test(empty.muscles), empty.muscles);
    check('tiles read zero rather than NaN', !/NaN/.test(empty.tiles), empty.tiles);

    await page.evaluate(() => showHistorySection('workouts'));
    await page.waitForTimeout(300);
    const noWk = await page.evaluate(() => document.getElementById('hxDayList').textContent);
    check('the workouts feed says it is empty', /Nothing logged in this range/.test(noWk), noWk);
    await ctx.close();
  }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
