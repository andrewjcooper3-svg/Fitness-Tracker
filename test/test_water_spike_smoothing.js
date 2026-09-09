/* A big, un-ranged water entry (no explicit end time) is more likely a
   rushed catch-up log - "I forgot to track, here's my total for the last
   few hours" - than someone actually gulping 64oz in one instant. Fed
   straight into the "usual pace" dotted trend line, that reads as a sharp,
   unrealistic spike at whatever single slot the log happened to land in.

   computeSlotBuckets_'s new spreadSpikes option (only ever passed by
   waterSlotAverages_, never by the live per-day bar chart) treats an
   un-ranged entry above WATER_SPIKE_SPREAD_THRESHOLD_OZ as if it had an
   inferred WATER_SPIKE_SPREAD_MINUTES-wide span centered on the log time,
   and spreads it the same way a real explicit start/end range already
   gets spread - reusing that existing proportional-overlap logic rather
   than adding a new one.

   What is checked here:
     - a normal-sized instant entry (well under the threshold) still
       lands entirely in its one slot - no change for ordinary logging,
     - a big instant entry, when computed WITH spreadSpikes, is spread
       across several neighboring slots centered on its log time rather
       than concentrated in one,
     - the spread conserves the total hydration ounces - nothing is lost
       or gained, just redistributed across time,
     - that same big entry, computed WITHOUT spreadSpikes (i.e. exactly
       how the live per-day bar chart calls it), still lands entirely in
       one slot - today's own bars are never smoothed, only the
       historical average line is,
     - end-to-end: waterSlotAverages_ (which is what the chart actually
       calls) reflects the spread for a big entry logged on some other
       day. */
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
  await page.waitForTimeout(1000);

  console.log('=== A normal-sized instant entry is unaffected by spreadSpikes ===');
  const normalResult = await page.evaluate(() => {
    const entry = { id: 'e1', type: 'water', rawOz: 16, hydrationOz: 16, loggedAt: '2026-09-01T09:07:00.000' };
    const buckets = computeSlotBuckets_([entry], 30, 48, { spreadSpikes: true });
    const nonEmpty = buckets.map((list, i) => ({ i, oz: list.reduce((s, e) => s + e.hydrationOz, 0) })).filter(x => x.oz > 0);
    return nonEmpty;
  });
  check('lands entirely in exactly one slot', normalResult.length === 1 && Math.abs(normalResult[0].oz - 16) < 0.001, JSON.stringify(normalResult));

  console.log('\n=== A big (64oz) un-ranged entry, spread WITH spreadSpikes, fans out across neighboring slots ===');
  const spreadResult = await page.evaluate(() => {
    // 2:00pm, 30-min slots -> slot 28 is the log-time slot (14:00-14:30).
    const entry = { id: 'e2', type: 'water', rawOz: 64, hydrationOz: 64, loggedAt: '2026-09-01T14:00:00.000' };
    const buckets = computeSlotBuckets_([entry], 30, 48, { spreadSpikes: true });
    const nonEmpty = buckets.map((list, i) => ({ i, oz: list.reduce((s, e) => s + e.hydrationOz, 0) })).filter(x => x.oz > 0.001);
    return { nonEmpty, total: nonEmpty.reduce((s, x) => s + x.oz, 0) };
  });
  console.log('  slots touched:', JSON.stringify(spreadResult.nonEmpty));
  check('spreads across more than one slot', spreadResult.nonEmpty.length > 1, JSON.stringify(spreadResult.nonEmpty));
  check('no single slot still carries the full 64oz', spreadResult.nonEmpty.every(x => x.oz < 64), JSON.stringify(spreadResult.nonEmpty));
  check('the total hydration ounces is conserved (nothing lost or gained)', Math.abs(spreadResult.total - 64) < 0.01, String(spreadResult.total));

  console.log('\n=== The same big entry, WITHOUT spreadSpikes (how the live per-day bars call it), stays in one slot ===');
  const unspreadResult = await page.evaluate(() => {
    const entry = { id: 'e2', type: 'water', rawOz: 64, hydrationOz: 64, loggedAt: '2026-09-01T14:00:00.000' };
    const buckets = computeSlotBuckets_([entry], 30, 48); // no opts - exactly how renderWaterHourlyChart calls it for today
    const nonEmpty = buckets.map((list, i) => ({ i, oz: list.reduce((s, e) => s + e.hydrationOz, 0) })).filter(x => x.oz > 0);
    return nonEmpty;
  });
  check('today\'s own bars are never smoothed - full amount in one slot', unspreadResult.length === 1 && Math.abs(unspreadResult[0].oz - 64) < 0.001, JSON.stringify(unspreadResult));

  console.log('\n=== End-to-end: waterSlotAverages_ reflects the spread for a big entry on another day ===');
  const e2e = await page.evaluate(() => {
    const store = {
      days: {
        '2026-08-20': [{ id: 'big1', type: 'water', rawOz: 64, hydrationOz: 64, loggedAt: '2026-08-20T14:00:00.000' }]
      },
      deleted: {}
    };
    localStorage.setItem(STORAGE_WATER_ENTRIES_KEY, JSON.stringify(store));
    const avg = waterSlotAverages_(30, 48, '2026-09-09'); // excludeDay = some day not in the store
    const nonEmpty = avg.map((oz, i) => ({ i, oz })).filter(x => x.oz > 0.001);
    return { nonEmpty, total: nonEmpty.reduce((s, x) => s + x.oz, 0) };
  });
  console.log('  waterSlotAverages_ non-zero slots:', JSON.stringify(e2e.nonEmpty));
  check('waterSlotAverages_ spreads the big logged day across multiple slots', e2e.nonEmpty.length > 1, JSON.stringify(e2e.nonEmpty));
  check('averaged over 1 other day, the total still comes back to 64oz', Math.abs(e2e.total - 64) < 0.01, String(e2e.total));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
