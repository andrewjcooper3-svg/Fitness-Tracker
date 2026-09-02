/* The Morning Brief card at the top of Overview opens an in-app modal
   rendered from JSON the backend stores (loadMorningBrief_/
   saveMorningBrief_ in code.gs) - not a navigation to an external page,
   and not a new tab/popup. This checks the card is present above the
   reorderable ov-blocks grid, that clicking it opens the modal and fetches
   from the backend rather than navigating away, that an empty backend
   response shows the empty state, and that a real brief renders its
   sections (weather/calendar/inbox/headlines/events). */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const SAMPLE_BRIEF = {
  updatedAt: '2026-09-03T10:31:00Z',
  weather: { location: 'St. Petersburg, FL', high: 91, low: 78, condition: 'Scattered storms', alert: 'Drought advisory in effect' },
  calendar: [{ time: '9:00 AM', title: 'Dentist' }],
  inbox: { categories: [{ name: 'Financial', items: [{ subject: 'Statement ready' }] }] },
  headlines: [{ title: 'Market rallies', summary: 'Stocks closed higher on tech gains.' }],
  markets: { summary: 'Dow +1.2% · S&P +0.9% · Nasdaq +1.5%' },
  events: [{ name: 'Farmers Market', date: 'Sat 9/6' }]
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', route => {
    const url = route.request().url();
    if (url.includes('action=loadMorningBrief')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: null }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' });
  });

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
      isBeforeBlocks: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING),
      title: (card.querySelector('.ov-brief-card-title') || {}).textContent
    };
  });
  check('the card is present', info.found);
  check('it sits before the reorderable ov-blocks grid', info.isBeforeBlocks);
  check('it says "Morning Brief"', info.title === 'Morning Brief', info.title);
  check('its click handler opens the in-app modal (not a location change)', info.onclick === 'openMorningBriefModal()', info.onclick);

  console.log('\n=== Clicking it opens the modal in-app, no navigation, no popup ===');
  let openedPopup = false;
  page.on('popup', () => { openedPopup = true; });
  const navigations = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) navigations.push(f.url()); });
  await page.click('#view-overview .ov-brief-card');
  await page.waitForTimeout(300);
  check('no popup/new tab was opened', !openedPopup);
  check('the main frame never navigated away', navigations.every(u => u.startsWith('file://')), JSON.stringify(navigations));
  const isOpen = await page.evaluate(() => document.getElementById('morningBriefOverlay').classList.contains('open'));
  check('the modal overlay is open', isOpen);

  console.log('\n=== With nothing stored yet, it shows the empty state ===');
  const emptyText = await page.evaluate(() => document.getElementById('mbContent').textContent);
  check('shows the "no briefing yet" message', /No briefing yet/.test(emptyText), emptyText);

  console.log('\n=== Close, then reopen with a real stored brief and it renders every section ===');
  await page.click('#morningBriefOverlay .event-modal-close');
  await page.waitForTimeout(150);
  const closedNow = await page.evaluate(() => document.getElementById('morningBriefOverlay').classList.contains('open'));
  check('Close actually closes it', !closedNow);

  // Playwright routes stack with the earlier handler matching first, so
  // unroute it before installing the version that returns real data.
  await page.unroute('https://script.google.com/**');
  await page.route('https://script.google.com/**', route => {
    const url = route.request().url();
    if (url.includes('action=loadMorningBrief')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: SAMPLE_BRIEF }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' });
  });

  await page.click('#view-overview .ov-brief-card');
  await page.waitForTimeout(300);
  const rendered = await page.evaluate(() => document.getElementById('mbContent').innerHTML);
  check('renders the weather section', rendered.includes('St. Petersburg, FL') && rendered.includes('91') && rendered.includes('Drought advisory'));
  check('renders the calendar section', rendered.includes('9:00 AM') && rendered.includes('Dentist'));
  check('renders the inbox section', rendered.includes('Financial') && rendered.includes('Statement ready'));
  check('renders headlines and markets', rendered.includes('Market rallies') && rendered.includes('Dow +1.2%'));
  check('renders this week\'s events', rendered.includes('Farmers Market') && rendered.includes('Sat 9/6'));
  const updatedText = await page.evaluate(() => document.getElementById('mbUpdated').textContent);
  check('shows an "Updated ..." timestamp', /Updated/.test(updatedText), updatedText);

  console.log('\n=== The refresh button re-GENERATES live rather than re-reading the cache ===');
  const REGENERATED_BRIEF = { ...SAMPLE_BRIEF, updatedAt: '2026-09-03T14:00:00Z',
    weather: { ...SAMPLE_BRIEF.weather, high: 88 } };
  const hitActions = [];
  await page.unroute('https://script.google.com/**');
  await page.route('https://script.google.com/**', route => {
    const url = route.request().url();
    const action = new URLSearchParams(url.split('?')[1]).get('action');
    hitActions.push(action);
    if (action === 'refreshMorningBriefNow') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: REGENERATED_BRIEF }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: SAMPLE_BRIEF }) });
  });
  await page.click('#mbRefreshBtn');
  await page.waitForTimeout(300);
  check('Refresh calls the live-regenerate action, not the plain cache read', hitActions.includes('refreshMorningBriefNow'), JSON.stringify(hitActions));
  const stillOpen = await page.evaluate(() => document.getElementById('morningBriefOverlay').classList.contains('open'));
  check('the modal is still open after refresh', stillOpen);
  const afterRefresh = await page.evaluate(() => document.getElementById('mbContent').innerHTML);
  check('renders the freshly-regenerated data, not the stale cached value', afterRefresh.includes('88') && !afterRefresh.includes('>91'), afterRefresh.match(/mb-weather-temp">[^<]*/)[0]);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
