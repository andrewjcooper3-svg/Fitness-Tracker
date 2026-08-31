// The widget can only draw what the app publishes, and the app publishes
// blind - nothing on screen shows the payload. So it gets checked here.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve('/home/user/Fitness-Tracker/Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForTimeout(1000);
  // Log some pushups across the week so the strip has shape: Monday and
  // Wednesday done, Tuesday skipped.
  await page.evaluate(() => {
    const monday = getWeekMonday(), led = {};
    [165, 0, 165, 0, 55, 0, 0].forEach((n, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      if (n) led[dateKey(d)] = n;
    });
    localStorage.setItem('WORKOUT_PUSHUP_LEDGER', JSON.stringify(led));
  });
  await page.reload();
  await page.waitForTimeout(1400);

  const s = await page.evaluate(() => buildWidgetSummary_());
  console.log('  pushups:', JSON.stringify(s.pushups));
  console.log('  lift   :', JSON.stringify(s.lift));

  check('the payload carries today', typeof s.pushups.today === 'number', JSON.stringify(s.pushups.today));
  check('and today\'s target', s.pushups.todayTarget > 0, String(s.pushups.todayTarget));
  check('seven days, Monday first', s.pushups.days.length === 7, String(s.pushups.days.length));
  check('exactly one day is flagged today', s.pushups.days.filter(d => d.today).length === 1);

  // Targets come off the plan, not a constant: Sat is four sets, Sun none.
  const t = s.pushups.days.map(d => d.target);
  console.log('  targets Mon..Sun:', t.join(', '));
  check('weekday targets are 165 (3 x 55)', t.slice(0, 5).every(x => x === 165), t.join(','));
  check('Saturday is 220 (4 x 55)', t[5] === 220, String(t[5]));
  check('Sunday is 0 - it is the rest day', t[6] === 0, String(t[6]));
  check('the week sums to the 1,045 target', t.reduce((a, x) => a + x, 0) === 1045,
    String(t.reduce((a, x) => a + x, 0)));

  const done = s.pushups.days.map(d => d.done);
  console.log('  done    Mon..Sun:', done.join(', '));
  check('the skipped Tuesday shows as zero', done[1] === 0, String(done[1]));

  // Future days must be distinguishable from missed ones, or every week
  // looks like a disaster on Monday morning.
  const idx = s.pushups.days.findIndex(d => d.today);
  check('days after today are marked future',
    s.pushups.days.slice(idx + 1).every(d => d.future), JSON.stringify(s.pushups.days.map(d => d.future)));
  check('today and before are not', !s.pushups.days.slice(0, idx + 1).some(d => d.future));

  check('the next lift is reported', !!s.lift && !!s.lift.day, JSON.stringify(s.lift));
  check('and it is a real lifting day', ['Tuesday', 'Thursday'].includes(s.lift.day), s.lift.day);

  // Derived from the plan, so it must actually follow the plan.
  const derived = await page.evaluate(() => ({
    lift: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(isLiftDay_),
    satPush: planPushupsForDay_('sat'), sunPush: planPushupsForDay_('sun')
  }));
  console.log('  lift days:', derived.lift.join(', '));
  check('Tue and Thu are the lifting days', derived.lift.join(',') === 'tue,thu', derived.lift.join(','));
  check('a walk-and-sauna Saturday is not a lifting day', !derived.lift.includes('sat'));

  await ctx.close();
  await b.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
