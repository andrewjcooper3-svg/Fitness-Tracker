/* Three unrelated changes bundled into one regression pass since they all
   touch shared plumbing:
   1. The weekly plan moved gym days from Tue/Thu to Wed/Fri, made Monday a
      fixed rest day (like Sunday), added rear-delt work, and trimmed
      isolated tricep volume given daily pushups already load the triceps.
   2. Routines (day-tab classification, the week-widget and month-calendar
      headers, rtWeekStart itself) now starts every week on Monday, matching
      the convention the rest of the app already used.
   3. The water widget's hourly chart draws a dotted "usual pace" trend line
      averaged from other recently-logged days, at the same per-slot scale
      as today's bars, so a bar sitting below the line means behind pace. */
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

  console.log('=== Weekly plan: Monday rest, Wednesday/Friday gym, Tuesday/Thursday pushups ===');
  const plan = await page.evaluate(() => ({
    hasMonday: 'mon' in WEEKLY_PLAN_DATA,
    tueIsPushupOnly: WEEKLY_PLAN_DATA.tue.length === 1 && WEEKLY_PLAN_DATA.tue[0].name === 'Pushups',
    thuIsPushupOnly: WEEKLY_PLAN_DATA.thu.length === 1 && WEEKLY_PLAN_DATA.thu[0].name === 'Pushups',
    wedHasLegPress: WEEKLY_PLAN_DATA.wed.some(ex => ex.name === 'Leg Press'),
    friHasLegPress: WEEKLY_PLAN_DATA.fri.some(ex => ex.name === 'Leg Press'),
    monPushupTarget: document.getElementById('day-mon').dataset.pushupTarget,
    tueTab: document.querySelector('.day-tab[onclick*="\'tue\'"]').className,
    wedTab: document.querySelector('.day-tab[onclick*="\'wed\'"]').className,
    monTab: document.querySelector('.day-tab[onclick*="\'mon\'"]').className
  }));
  check('Monday has no plan entry (fixed rest day, like Sunday)', !plan.hasMonday);
  check('Monday\'s pushup target is 0', plan.monPushupTarget === '0', plan.monPushupTarget);
  check('Tuesday is now a plain pushup day', plan.tueIsPushupOnly);
  check('Thursday is now a plain pushup day', plan.thuIsPushupOnly);
  check('Wednesday picked up the gym content (Leg Press present)', plan.wedHasLegPress);
  check('Friday picked up the gym content (Leg Press present)', plan.friHasLegPress);
  check('Monday\'s tab is classed "rest"', /\brest\b/.test(plan.monTab), plan.monTab);
  check('Tuesday\'s tab is classed "home" (bodyweight)', /\bhome\b/.test(plan.tueTab), plan.tueTab);
  check('Wednesday\'s tab is classed "gym"', /\bgym\b/.test(plan.wedTab), plan.wedTab);

  console.log('\n=== Rear delts get more work; daily pushups mean less added tricep isolation ===');
  const arms = await page.evaluate(() => ({
    wedHasRearDelt: WEEKLY_PLAN_DATA.wed.some(ex => ex.name === 'Reverse Pec Deck Fly'),
    wedTricepSets: (WEEKLY_PLAN_DATA.wed.find(ex => ex.name === 'Tricep Pushdown') || {}).rows.length,
    friFacePullSets: (WEEKLY_PLAN_DATA.fri.find(ex => ex.name === 'Face Pull') || {}).rows.length,
    friTricepSets: (WEEKLY_PLAN_DATA.fri.find(ex => ex.name === 'Tricep Pulldown') || {}).rows.length
  }));
  check('Wednesday gained a dedicated rear-delt exercise', arms.wedHasRearDelt);
  check('Wednesday\'s tricep pushdown was trimmed from 3 sets to 2', arms.wedTricepSets === 2, arms.wedTricepSets);
  check('Friday\'s Face Pull (rear delt) went from 3 sets to 4', arms.friFacePullSets === 4, arms.friFacePullSets);
  check('Friday\'s tricep pulldown was trimmed from 3 sets to 2', arms.friTricepSets === 2, arms.friTricepSets);

  console.log('\n=== Routines: every week view starts on Monday, not Sunday ===');
  const routines = await page.evaluate(() => {
    const ws = rtWeekStart(new Date('2026-09-10T12:00:00')); // a Thursday
    const monthHeaders = [...document.querySelectorAll('#view-routines .rt-month-dow span')].map(s => s.textContent);
    return {
      weekStartDow: ws.getDay(),        // 1 = Monday
      weekStartDate: ws.getDate(),
      monthHeaders
    };
  });
  check('rtWeekStart(Thursday) resolves back to that week\'s Monday', routines.weekStartDow === 1 && routines.weekStartDate === 7, JSON.stringify(routines));
  check('the month-calendar header row now reads M T W T F S S', routines.monthHeaders.join('') === 'MTWTFSS', routines.monthHeaders.join(''));

  await page.evaluate(() => showAppView('routines'));
  await page.waitForTimeout(300);
  const monthGrid = await page.evaluate(() => {
    rtRenderMonthGrid();
    const cells = [...document.querySelectorAll('#rtMonthGrid .rt-month-cell')];
    const firstRealIdx = cells.findIndex(c => !c.classList.contains('pad'));
    return { padCount: firstRealIdx };
  });
  // 2026-09-01 is a Tuesday - Monday-first, that's 1 leading pad cell.
  check('the month grid pads day 1 to the right weekday column (Monday-first)', monthGrid.padCount === 1, JSON.stringify(monthGrid));

  console.log('\n=== Water chart: a dotted trend line for the usual pace ===');
  const noHistory = await page.evaluate(() => {
    renderOverviewWaterWidget();
    return {
      hasLine: document.getElementById('wtHourlyChart').innerHTML.includes('<polyline'),
      noteVisible: document.getElementById('wtChartAvgNote').style.display !== 'none'
    };
  });
  check('with no other days logged, no trend line is drawn', !noHistory.hasLine && !noHistory.noteVisible, JSON.stringify(noHistory));

  const withHistory = await page.evaluate(() => {
    const fmt = d => { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; };
    const days = {};
    for (let i = 1; i <= 3; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const morning = new Date(d); morning.setHours(9, 0, 0, 0);
      days[fmt(d)] = [{ id: 'seed' + i, loggedAt: morning.toISOString(), hydrationOz: 16, rawOz: 16, type: 'water' }];
    }
    localStorage.setItem('WORKOUT_WATER_ENTRIES', JSON.stringify({ days, deleted: {} }));
    renderOverviewWaterWidget();
    const svgHtml = document.getElementById('wtHourlyChart').innerHTML;
    return {
      hasLine: svgHtml.includes('<polyline'),
      pointCount: (svgHtml.match(/<polyline points="([^"]*)"/) || [, ''])[1].trim().split(' ').filter(Boolean).length,
      noteVisible: document.getElementById('wtChartAvgNote').style.display !== 'none'
    };
  });
  check('with 3 other days logged, the dotted trend line is drawn', withHistory.hasLine);
  check('the trend line has one point per slot', withHistory.pointCount === 48, withHistory.pointCount); // 30-min slots by default
  check('the "usual pace" caption becomes visible', withHistory.noteVisible);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
