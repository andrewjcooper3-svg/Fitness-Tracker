/* Two reports, one root cause: "the muscle chart shows 1.8 sets" and
   "is that because a set was marked tough?".

   It was not. Weighted attribution was reachable only from inside the
   Muscle balance modal, but the setting is persisted and drives the CARD
   too - so a reader who turned it on once came back later to a chart of
   fractions with no control and no explanation anywhere near it.

   What is checked here is the fix, in the browser: the mode is visible and
   switchable on the card itself, it says out loud where the fractions come
   from, and primary mode is whole numbers. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

// A week with pushups in it, and quality tags spread across the rows so a
// chart that discounted a "tough" set would read differently here.
const ROWS = [
  { date: '2026-08-24', day: 'Monday', exercise: 'Machine Chest Press', sets: 2, done: 2,
    topWeight: 90, volume: 1800, targetReps: 10, totalReps: 20, green: 2, yellow: 0, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' },
  { date: '2026-08-24', day: 'Monday', exercise: 'Pushups', sets: 3, done: 3,
    topWeight: 0, volume: 0, targetReps: 55, totalReps: 165, green: 0, yellow: 3, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' },
  { date: '2026-08-24', day: 'Monday', exercise: 'Lat Pulldown', sets: 3, done: 3,
    topWeight: 110, volume: 3300, targetReps: 10, totalReps: 30, green: 1, yellow: 1, red: 1, week: 'Week of Aug 24 - Aug 30, 2026' }
];

const readCard = page => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#hxMuscles .hx-muscle')].map(r => ({
    name: r.querySelector('.hx-muscle-name').textContent.trim(),
    value: r.querySelector('.hx-muscle-val').textContent.trim()
  }));
  const seg = document.getElementById('hxCardModeSeg');
  return {
    rows,
    note: (document.getElementById('hxMuscleNote') || {}).textContent || '',
    segVisible: !!seg && seg.getBoundingClientRect().width > 0,
    active: seg ? [...seg.querySelectorAll('button')].filter(b => b.classList.contains('active'))
      .map(b => b.dataset.mode) : [],
    // What the reader sees when they open Chest.
    chestEx: [...document.querySelectorAll('#hxMuscles .hx-muscle-ex div')]
      .map(d => d.textContent.trim())
  };
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [w, h, tag] of [[430, 932, 'phone'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} (${w}x${h}) ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

    // Seeded as the cache, and with weighted already on - the exact state a
    // reader lands in after visiting the modal once on an earlier day.
    await page.addInitScript(rows => {
      localStorage.setItem('WORKOUT_HISTORY_CACHE', JSON.stringify({ rows, at: new Date().toISOString() }));
      localStorage.setItem('WORKOUT_HISTORY_MUSCLE_MODE', 'weighted');
      localStorage.setItem('WORKOUT_HISTORY_MUSCLE_WINDOW', 'range');
    }, ROWS);

    await page.goto(URL);
    await page.waitForTimeout(900);
    await page.evaluate(() => { showAppView('stats'); renderStatsTab(); });
    await page.waitForTimeout(600);

    const weighted = await readCard(page);
    check('the mode control is on the card, not only in the modal', weighted.segVisible);
    check('and it shows the mode that is actually in force',
      weighted.active.join() === 'weighted', weighted.active.join() || '(none active)');
    check('the note explains the fractions', /weighted/i.test(weighted.note) && /fractional/i.test(weighted.note),
      weighted.note);
    check('nothing in the note blames the quality tags', !/tough|quality/i.test(weighted.note));

    const chest = weighted.rows.find(r => /chest/i.test(r.name));
    check('Chest is on the chart', !!chest, weighted.rows.map(r => r.name).join(', '));
    // Not every group lands on a fraction - Chest here is 1.8 + 1.2 = 3 flat.
    // The point is that the mode produces them at all, which is what the
    // note has to account for.
    check('weighted mode puts fractions on the chart',
      weighted.rows.some(r => /\d+\.\d/.test(r.value)),
      weighted.rows.map(r => `${r.name} ${r.value}`).join(', '));

    // Open Chest: the exercises feeding it have to name Pushups.
    await page.evaluate(() => toggleHistoryMuscle('Chest'));
    await page.waitForTimeout(250);
    const opened = await readCard(page);
    check('opening Chest lists Pushups inside it',
      opened.chestEx.some(t => /pushups/i.test(t)), opened.chestEx.join(' | ') || '(nothing)');

    // Switch to primary from the card itself.
    await page.click('#hxCardModeSeg button[data-mode="primary"]');
    await page.waitForTimeout(300);
    const primary = await readCard(page);
    check('the card control switches the mode', primary.active.join() === 'primary', primary.active.join());
    check('primary mode is whole sets, every row',
      primary.rows.length > 0 && primary.rows.every(r => !/\d+\.\d/.test(r.value)),
      primary.rows.map(r => `${r.name} ${r.value}`).join(', '));
    check('Pushups is still under Chest in primary mode',
      primary.chestEx.some(t => /pushups/i.test(t)), primary.chestEx.join(' | ') || '(nothing)');
    check('and the note drops the weighted explanation', !/fractional/i.test(primary.note), primary.note);

    // The modal is the other half of the same setting; it must agree.
    await page.evaluate(() => openMuscleBalanceModal());
    await page.waitForTimeout(300);
    const modal = await page.evaluate(() => [...document.querySelectorAll('#hxModeSeg button')]
      .filter(b => b.classList.contains('active')).map(b => b.dataset.mode));
    check('the modal follows the card', modal.join() === 'primary', modal.join());
    await page.evaluate(() => closeMuscleBalanceModal());

    // The head holds two segments now; neither may push the page sideways.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('the card head does not overflow the page', !overflow);

    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
