/* The active tab always centers itself in the (still freely, manually
   scrollable) top tab bar, with neighbors peeking in under a fade mask at
   each edge - including the very first and last tabs, which need phantom
   scroll padding before/after the row to reach a true center (otherwise
   scrollLeft would have to go negative or past the natural max). This
   checks centering holds for a first, middle, and last tab, that the
   fade mask is genuinely applied, and that the bar is still manually
   scrollable by dragging it. */
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

  async function centerOffset(view) {
    await page.evaluate(v => showAppView(v), view);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const bar = document.getElementById('appTabs');
      const active = bar.querySelector('.app-tab.active');
      const barRect = bar.getBoundingClientRect();
      const tabRect = active.getBoundingClientRect();
      return Math.abs((tabRect.left + tabRect.width / 2) - (barRect.left + barRect.width / 2));
    });
  }

  console.log('=== The active tab centers itself, including the first and last (edge cases) ===');
  check('the first tab (briefing) centers exactly', await centerOffset('briefing') < 1);
  check('a middle tab (stats) centers exactly', await centerOffset('stats') < 1);
  check('the last tab (routines) centers exactly', await centerOffset('routines') < 1);
  check('back to overview still centers exactly', await centerOffset('overview') < 1);

  console.log('\n=== The fade mask is genuinely applied, not just described in a comment ===');
  const maskInfo = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('appTabs'));
    return { mask: cs.maskImage, webkitMask: cs.webkitMaskImage };
  });
  check('mask-image is a real gradient, not "none"', /linear-gradient/.test(maskInfo.mask), maskInfo.mask);
  check('-webkit-mask-image matches (Safari/iOS coverage)', /linear-gradient/.test(maskInfo.webkitMask), maskInfo.webkitMask);

  console.log('\n=== The bar is still freely, manually scrollable (not locked to only the centered tab) ===');
  const beforeScroll = await page.evaluate(() => document.getElementById('appTabs').scrollLeft);
  await page.evaluate(() => { document.getElementById('appTabs').scrollLeft = 0; });
  await page.waitForTimeout(100);
  const afterManualScroll = await page.evaluate(() => document.getElementById('appTabs').scrollLeft);
  check('scrollLeft can be moved away from the centered position by hand', afterManualScroll === 0 && beforeScroll !== 0, `before=${beforeScroll} after=${afterManualScroll}`);
  const overflow = await page.evaluate(() => getComputedStyle(document.getElementById('appTabs')).overflowX);
  check('overflow-x is still auto (draggable/scrollable), not hidden', overflow === 'auto', overflow);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
