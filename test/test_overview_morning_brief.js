/* A "Morning Brief" card sits at the very top of the Overview tab, above
   the reorderable ov-blocks grid, and navigates the CURRENT view (not a
   new tab/window) to the externally-hosted briefing page. This checks
   it's present before any of the reorderable blocks, carries no
   target="_blank"/window.open, and that its href actually points at the
   right page. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
const BRIEF_URL = 'https://claude.ai/code/artifact/e106dcb7-2b39-4584-ada5-6a7264f5e1f5';
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  // The sandbox this test runs in has no real network access to claude.ai -
  // stub the briefing URL so a real navigation can actually complete and be
  // observed, instead of testing against a network error page.
  await page.route(BRIEF_URL, r =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub brief</title>' }));

  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => showAppView('overview'));
  await page.waitForTimeout(300);

  console.log('=== The Morning Brief card exists, above the reorderable blocks ===');
  const info = await page.evaluate(() => {
    const view = document.getElementById('view-overview');
    const card = view.querySelector('.ov-brief-card');
    const blocks = document.getElementById('ovBlocks');
    if (!card) return { found: false };
    const pos = card.compareDocumentPosition(blocks);
    return {
      found: true,
      onclick: card.getAttribute('onclick'),
      target: card.getAttribute('target'),
      isBeforeBlocks: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING),
      title: (card.querySelector('.ov-brief-card-title') || {}).textContent
    };
  });
  check('the card is present', info.found);
  check('it has no target="_blank"', !info.target, String(info.target));
  check('it sits before the reorderable ov-blocks grid', info.isBeforeBlocks);
  check('it says "Morning Brief"', info.title === 'Morning Brief', info.title);
  check('its click handler navigates to the briefing page (no new tab)',
    info.onclick === `location.href='${BRIEF_URL}'`, info.onclick);

  console.log('\n=== Clicking it navigates the current page, not a popup ===');
  let openedPopup = false;
  page.on('popup', () => { openedPopup = true; });
  const navigations = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) navigations.push(f.url()); });
  await page.click('#view-overview .ov-brief-card');
  await page.waitForTimeout(300);
  check('no popup/new tab was opened', !openedPopup);
  check('the current frame navigated to the briefing URL', navigations.some(u => u === BRIEF_URL), JSON.stringify(navigations));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
