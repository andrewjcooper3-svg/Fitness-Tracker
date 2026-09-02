/* Swipe-to-delete on a set row (or a whole exercise card) and swipe-to-
   switch-tabs are two independent gesture systems: the row/card delete
   swipe is built on Pointer Events (initSetSwipe/initExerciseSwipe), while
   tab navigation listens for native Touch Events directly on `document`
   (initTabSwipeNav). Calling stopPropagation() on a pointer event does
   NOT stop the browser from also dispatching the matching touch event -
   they're independent event systems for the same physical gesture - so
   without an explicit exclusion, both fired on every set-row swipe and
   the tab-swipe consistently won (it calls preventDefault() and drags the
   whole tab track), making swipe-to-delete on a set feel almost
   nonfunctional. This checks that a horizontal drag starting on a
   .set-row or .exercise-card never moves the tab track, while the same
   drag starting somewhere neutral still switches tabs normally. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => showAppView('tracker'));
  await page.waitForTimeout(300);

  // A left-swipe gesture as raw touch events, dispatched at the given
  // element so `e.target` inside initTabSwipeNav's listeners is exactly
  // that element (bubbling still reaches the document-level listeners).
  async function swipeLeft(selector) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { ok: false, reason: 'selector not found: ' + sel };
      const points = [[300, 500], [270, 500], [230, 500], [180, 500]];
      const fire = (type, [x, y]) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [touch], targetTouches: [], changedTouches: [touch], bubbles: true, cancelable: true }));
      };
      fire('touchstart', points[0]);
      points.slice(1).forEach(p => fire('touchmove', p));
      fire('touchend', points[points.length - 1]);
      return { ok: true };
    }, selector);
  }

  console.log('=== Baseline: on the Trainer tab ===');
  let idx = await page.evaluate(() => currentViewIndex);
  const trackerIdx = await page.evaluate(() => viewOrder.indexOf('tracker'));
  check('starts on the Trainer (tracker) view', idx === trackerIdx, `${idx} vs ${trackerIdx}`);

  console.log('\n=== A left-swipe starting ON a set row never moves the tab track ===');
  const beforeTransform = await page.evaluate(() => document.getElementById('appViewsTrack').style.transform);
  const setRowSwipe = await swipeLeft('#day-tue .exercise-card .set-row');
  check('found a set-row to swipe on', setRowSwipe.ok, JSON.stringify(setRowSwipe));
  await page.waitForTimeout(150);
  const afterSetRowIdx = await page.evaluate(() => currentViewIndex);
  const afterSetRowTransform = await page.evaluate(() => document.getElementById('appViewsTrack').style.transform);
  check('the active view did not change', afterSetRowIdx === trackerIdx, `${afterSetRowIdx} vs ${trackerIdx}`);
  check('the tab track was never dragged', afterSetRowTransform === beforeTransform, `"${beforeTransform}" vs "${afterSetRowTransform}"`);

  console.log('\n=== Same drag starting on an exercise card is also excluded ===');
  const cardSwipe = await swipeLeft('#day-tue .exercise-card');
  check('found an exercise-card to swipe on', cardSwipe.ok, JSON.stringify(cardSwipe));
  await page.waitForTimeout(150);
  const afterCardIdx = await page.evaluate(() => currentViewIndex);
  check('the active view still did not change', afterCardIdx === trackerIdx, `${afterCardIdx} vs ${trackerIdx}`);

  console.log('\n=== The same drag starting somewhere neutral still switches tabs (fix is scoped, not a regression) ===');
  const neutralSwipe = await swipeLeft('#day-tue');
  check('found the neutral day-panel target', neutralSwipe.ok, JSON.stringify(neutralSwipe));
  await page.waitForTimeout(450); // tab-swipe animates before settling
  const afterNeutralIdx = await page.evaluate(() => currentViewIndex);
  check('the active view DID change when the drag started off the card/row', afterNeutralIdx !== trackerIdx, `${afterNeutralIdx} vs ${trackerIdx}`);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
