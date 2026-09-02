/* Does logging a peak/rising/falling observation on the Starter tab
   actually move the schedule, or is it cosmetic? The whole page - the
   status headline, the "next feed due" time, the chart curve, the gap
   advice, and the backward bake-planner - all read the SAME calibrated
   number (starterPeakHours_ = sdModelPeakHours_ * starterCalibration_),
   so this checks the one thing that actually matters: that logging a
   real observation changes starterCalibration_ away from 1, and that
   the change propagates into starterStatus_'s peakH/intervalH/dueAt and
   into the "Peak model" meta tile - not just into some inert field
   nothing else reads. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const starter = () => ({
  stage: 'active', name: 'Doughy', bornOn: new Date(Date.now() - 90 * 86400000).toISOString(),
  build: {}, location: 'counter', ratio: '1:2:2', flour: 'bread', keepG: 50, tempF: 72,
  feeds: [{ id: 'f1', at: new Date(Date.now() - 10 * 3600000).toISOString(),
            keepG: 50, ratio: '1:2:2', flour: 'bread', tempF: 72, location: 'counter', checks: [] }]
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 430, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.addInitScript(st => localStorage.setItem('WORKOUT_KITCHEN_STARTER', JSON.stringify(st)), starter());
  await page.goto(URL);
  await page.waitForFunction(() => typeof renderStarter === 'function', null, { timeout: 15000 });
  await page.evaluate(() => { showAppView('kitchen'); showKitchenSection('starter'); });
  await page.waitForTimeout(500);

  console.log('=== Before any observation, the schedule is the plain book model ===');
  const before = await page.evaluate(() => {
    const st = loadStarter_();
    const status = starterStatus_(st, new Date());
    return {
      cal: starterCalibration_(st),
      modelled: sdModelPeakHours_(st.feeds[0].tempF, st.feeds[0].ratio, st.feeds[0].flour),
      peakH: status.peakH,
      intervalH: status.intervalH,
      dueAt: status.dueAt,
      metaTile: document.getElementById('sdMetaRow').textContent.replace(/\s+/g, ' ').trim()
    };
  });
  check('calibration starts neutral (untouched book model)', before.cal === 1, String(before.cal));
  check('the "Peak model" tile says Book, not a percentage', /Book/.test(before.metaTile), before.metaTile);

  console.log('\n=== Logging a "peak" at half the modelled time recalibrates it ===');
  await page.evaluate((modelled) => {
    const st = loadStarter_();
    const last = sdLastFeed_(st);
    const fedAt = new Date(last.at);
    const fastPeak = new Date(fedAt.getTime() + (modelled / 2) * 3600000);
    sdCheckDraft = { feedId: last.id, time: '', state: 'peak', riseX: 2, hooch: false };
    document.getElementById('sdCheckTime').value =
      String(fastPeak.getHours()).padStart(2, '0') + ':' + String(fastPeak.getMinutes()).padStart(2, '0');
  }, before.modelled);
  await page.evaluate(() => logStarterRise());
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const st = loadStarter_();
    const status = starterStatus_(st, new Date());
    return {
      cal: starterCalibration_(st),
      peakH: status.peakH,
      intervalH: status.intervalH,
      dueAt: status.dueAt.toISOString(),
      metaTile: document.getElementById('sdMetaRow').textContent.replace(/\s+/g, ' ').trim(),
      learnedLine: (document.getElementById('sdCheckLearned') || {}).textContent
    };
  });

  check('the calibration factor actually moved (a real peak beats a guess)', after.cal !== 1 && after.cal < 1, String(after.cal));
  check('the calibrated peak hours are faster than the book model', after.peakH < before.peakH, `${before.peakH.toFixed(2)} -> ${after.peakH.toFixed(2)}`);
  check('the next-feed-due time moved earlier to match', new Date(after.dueAt) < before.dueAt, `${before.dueAt.toISOString()} -> ${after.dueAt}`);
  check('the "Peak model" tile now reports Fast with a percentage, not Book', /Fast \d+% of book/.test(after.metaTile), after.metaTile);
  check('the check form tells you what it just learned', /now expects this feed to peak in about/.test(after.learnedLine), after.learnedLine);

  console.log('\n=== A "still rising" check that does not contradict the model is a real "matches" ===');
  // "Matches" (ratio === 1, no correction) is a real, reachable outcome
  // for a BOUND observation (rising/falling/collapsed) - sdPeakEvidence_
  // explicitly snaps to ratio 1 whenever the model already satisfies the
  // bound. An EXACT peak time essentially never lands on ratio === 1 to
  // floating-point precision (a logged HH:MM is never exactly the
  // model's fractional-hour prediction), so a bound is the honest way to
  // exercise this branch rather than a peak reading that merely looks
  // close on screen.
  await page.evaluate(() => {
    const st = loadStarter_();
    st.feeds.push({ id: 'f2', at: new Date().toISOString(), keepG: 50, ratio: '1:2:2', flour: 'bread', tempF: 72, location: 'counter', checks: [] });
    saveStarter_(st);
    renderStarter();
  });
  await page.waitForTimeout(200);
  const bookPeakHours = await page.evaluate(() => {
    const st = loadStarter_();
    return sdModelPeakHours_(st.feeds[1].tempF, st.feeds[1].ratio, st.feeds[1].flour);
  });
  await page.evaluate((peakH) => {
    const st = loadStarter_();
    const last = sdLastFeed_(st);
    const fedAt = new Date(last.at);
    // A quarter of the way to the book's own peak estimate - comfortably
    // still rising under any plausible model, so this bound cannot
    // contradict it.
    const earlyCheck = new Date(fedAt.getTime() + (peakH / 4) * 3600000);
    sdCheckDraft = { feedId: last.id, time: '', state: 'rising', riseX: 1.3, hooch: false };
    document.getElementById('sdCheckTime').value =
      String(earlyCheck.getHours()).padStart(2, '0') + ':' + String(earlyCheck.getMinutes()).padStart(2, '0');
  }, bookPeakHours);
  await page.evaluate(() => logStarterRise());
  await page.waitForTimeout(300);
  const confirmLearnedLine = await page.evaluate(() => (document.getElementById('sdCheckLearned') || {}).textContent);
  check('a bound that does not contradict the model says nothing needed changing', /matches what the model already expected/.test(confirmLearnedLine), confirmLearnedLine);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
