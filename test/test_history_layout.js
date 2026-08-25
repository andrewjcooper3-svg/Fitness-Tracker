/* Arranging the Overview cards.
   The interesting failures are not "does the arrow move a card" - they are
   what happens later:
     - a saved order has to survive a reload,
     - a hidden card must not take its chart's element with it, so showing
       it again draws rather than coming back blank,
     - and a card added to the HTML after someone saved a layout has to
       APPEAR for them. That last one is how a saved layout normally rots:
       the stored list is treated as the whole truth, and every card
       shipped afterwards is invisible to exactly the users who cared
       enough to arrange the page.
   All three are checked here. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const ROWS = [
  { date: '2026-08-24', day: 'Monday', exercise: 'Leg Press', sets: 3, done: 3, topWeight: 255,
    volume: 7650, targetReps: 10, totalReps: 30, green: 1, yellow: 2, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' },
  { date: '2026-08-24', day: 'Monday', exercise: 'Pushups', sets: 3, done: 3, topWeight: 0,
    volume: 0, targetReps: 55, totalReps: 165, green: 0, yellow: 3, red: 0, week: 'Week of Aug 24 - Aug 30, 2026' }
];

// Flow order as rendered, and which cards are actually on screen.
const shown = page => page.evaluate(() => {
  const sec = document.getElementById('hxSectionOverview');
  return [...sec.querySelectorAll('[data-hxcard]')]
    .filter(c => c.getBoundingClientRect().height > 0)
    .map(c => c.dataset.hxcard);
});
const order = page => page.evaluate(() => [...document
  .getElementById('hxSectionOverview').querySelectorAll('[data-hxcard]')].map(c => c.dataset.hxcard));

const openEditor = async page => {
  await page.evaluate(() => openHistoryLayout());
  await page.waitForTimeout(250);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [w, h, tag] of [[430, 932, 'phone'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} (${w}x${h}) ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.addInitScript(rows => {
      localStorage.setItem('WORKOUT_HISTORY_CACHE', JSON.stringify({ rows, at: new Date().toISOString() }));
    }, ROWS);

    await page.goto(URL);
    await page.waitForTimeout(900);
    await page.evaluate(() => { showAppView('stats'); renderStatsTab(); });
    await page.waitForTimeout(600);

    const authored = await order(page);
    check('every Overview card is identified', authored.length === 7, authored.join(', '));
    check('the layout button is offered', await page.isVisible('#hxLayoutBtn'));

    // ...and only on Overview, where there are cards to arrange.
    await page.evaluate(() => showHistorySection('workouts'));
    await page.waitForTimeout(200);
    check('and hidden on the segments with no cards', !(await page.isVisible('#hxLayoutBtn')));
    await page.evaluate(() => showHistorySection('overview'));
    await page.waitForTimeout(300);

    await openEditor(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#hxLayoutList .hx-layout-row')].length);
    check('the editor lists them all', rows === 7, String(rows));
    check('the first card cannot move up', await page.evaluate(() =>
      document.querySelector('#hxLayoutList .hx-layout-row .hx-layout-move').disabled));

    // Move the weight card from last to first, one step at a time.
    for (let i = 0; i < 6; i++) await page.evaluate(() => moveHistoryCard('weight', -1));
    await page.waitForTimeout(400);
    const moved = await order(page);
    check('the moved card is now first', moved[0] === 'weight', moved.join(', '));
    check('and nothing else was lost', moved.length === 7, moved.join(', '));

    // Hide two, and confirm they leave the flow without leaving the DOM.
    await page.evaluate(() => { toggleHistoryCard('pushups'); toggleHistoryCard('freq'); });
    await page.waitForTimeout(400);
    const visible = await shown(page);
    check('hidden cards leave the page', !visible.includes('pushups') && !visible.includes('freq'),
      visible.join(', '));
    check('the rest stay', visible.length === 5, visible.join(', '));
    check('but they are still in the DOM', (await order(page)).length === 7);

    await page.evaluate(() => closeHistoryLayout());
    await page.waitForTimeout(300);

    // Reload: the arrangement is the point, so it has to come back.
    await page.reload();
    await page.waitForTimeout(900);
    await page.evaluate(() => { showAppView('stats'); renderStatsTab(); });
    await page.waitForTimeout(600);
    const after = await shown(page);
    check('the order survives a reload', after[0] === 'weight', after.join(', '));
    check('and so does what was hidden',
      !after.includes('pushups') && !after.includes('freq'), after.join(', '));

    // Showing a card again must redraw it. A chart that was display:none
    // had no width to lay out into, so this is where it comes back blank.
    await openEditor(page);
    await page.evaluate(() => toggleHistoryCard('freq'));
    await page.waitForTimeout(500);
    await page.evaluate(() => closeHistoryLayout());
    await page.waitForTimeout(400);
    const freq = await page.evaluate(() => {
      const svg = document.getElementById('hxFreqChart');
      const r = svg.getBoundingClientRect();
      return { w: Math.round(r.width), marks: svg.querySelectorAll('path, rect, line').length };
    });
    check('a card brought back has width again', freq.w > 100, String(freq.w));
    check('and its chart redrew', freq.marks > 0, String(freq.marks) + ' marks');

    // Reset puts the authored order back.
    await openEditor(page);
    await page.evaluate(() => resetHistoryLayout());
    await page.waitForTimeout(400);
    const reset = await shown(page);
    check('reset restores the authored order', reset.join() === authored.join(),
      reset.join(', '));
    await page.evaluate(() => closeHistoryLayout());

    /* The rot case. Someone saved a layout before a card existed; the card
       is in the markup now. It must show up, positioned where it was
       authored rather than dumped at the end. */
    await page.evaluate(() => {
      localStorage.setItem('WORKOUT_HISTORY_LAYOUT', JSON.stringify({
        order: ['tiles', 'volume', 'completion', 'weight', 'gone-since'],   // no 'muscles', no 'freq', no 'pushups'
        hidden: []
      }));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.evaluate(() => { showAppView('stats'); renderStatsTab(); });
    await page.waitForTimeout(600);
    const rot = await shown(page);
    check('a card saved layouts never heard of still appears',
      rot.includes('muscles') && rot.includes('freq') && rot.includes('pushups'), rot.join(', '));
    check('an id that no longer exists is ignored', !rot.includes('gone-since'), rot.join(', '));
    check('all seven are on screen', rot.length === 7, rot.join(', '));
    check('the saved relative order is respected',
      rot.indexOf('tiles') < rot.indexOf('volume')
      && rot.indexOf('volume') < rot.indexOf('completion')
      && rot.indexOf('completion') < rot.indexOf('weight'), rot.join(', '));
    // freq was authored right after tiles, so that is where it belongs.
    check('and the new card landed where it was authored',
      rot.indexOf('freq') === rot.indexOf('tiles') + 1, rot.join(', '));

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('the page does not scroll sideways', !overflow);

    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
