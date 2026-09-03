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
  weather: {
    location: 'St. Petersburg, FL', high: 91, low: 78, condition: 'Scattered storms', alert: 'Drought advisory in effect',
    rainChance: 60, wind: 'SE 12 mph',
    hourly: [
      { time: '9am', temp: 82, precip: 10 }, { time: '10am', temp: 85, precip: 20 }, { time: '11am', temp: 88, precip: 30 },
      { time: '12pm', temp: 90, precip: 40 }, { time: '1pm', temp: 91, precip: 50 }, { time: '2pm', temp: 91, precip: 60 }
    ]
  },
  calendar: [{ time: '9:00 AM', title: 'Dentist' }],
  inbox: { categories: [{ name: 'Financial', count: 1, items: [{ subject: 'Statement ready', from: 'Vanguard', threadId: 'thread-abc123' }] }] },
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
  check('renders the inbox section with the sender, not just the category', rendered.includes('Financial') && rendered.includes('Vanguard') && rendered.includes('Statement ready'));
  check('renders headlines and markets', rendered.includes('Market rallies') && rendered.includes('Dow +1.2%'));
  check('renders this week\'s events', rendered.includes('Farmers Market') && rendered.includes('Sat 9/6'));
  const updatedText = await page.evaluate(() => document.getElementById('mbUpdated').textContent);
  check('shows an "Updated ..." timestamp', /Updated/.test(updatedText), updatedText);

  console.log('\n=== The hourly weather chart toggles between temp and rain ===');
  const hourlyInfo = await page.evaluate(() => {
    const chart = document.getElementById('mbHourlyChart');
    const before = chart ? chart.innerHTML : '';
    const rainBtn = [...document.querySelectorAll('.mb-hourly-btn')].find(b => b.textContent.trim() === 'Rain');
    rainBtn.click();
    const after = chart ? chart.innerHTML : '';
    return { hasChart: !!chart, beforeHasSvg: /<svg/.test(before), beforeShowsTemp: /82°/.test(before), afterShowsRain: /10%/.test(after), rainBtnActive: rainBtn.classList.contains('active') };
  });
  check('the hourly chart renders an SVG by default', hourlyInfo.hasChart && hourlyInfo.beforeHasSvg);
  check('defaults to showing temperature values', hourlyInfo.beforeShowsTemp);
  check('tapping Rain switches the chart to precipitation values', hourlyInfo.afterShowsRain);
  check('tapping Rain marks it active', hourlyInfo.rainBtnActive);

  console.log('\n=== Tapping an inbox row opens a preview, fetched only on demand ===');
  const previewHits = [];
  await page.route('https://script.google.com/**', route => {
    const url = route.request().url();
    if (url.includes('action=getEmailPreview')) {
      previewHits.push(url);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', preview: { subject: 'Statement ready', from: 'Vanguard', snippet: 'Your September statement is now available online.' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: SAMPLE_BRIEF }) });
  });
  await page.click('.mb-inbox-row');
  await page.waitForTimeout(300);
  const afterOpenDetail = await page.evaluate(() => {
    const item = document.querySelector('.mb-inbox-item');
    const detail = item.querySelector('.mb-inbox-detail');
    return { visible: detail.style.display !== 'none', isOpen: item.classList.contains('open'), snippet: detail.querySelector('.mb-inbox-snippet').textContent };
  });
  check('the detail panel opens on tap', afterOpenDetail.visible && afterOpenDetail.isOpen);
  check('fetched exactly one preview for the tapped thread', previewHits.length === 1 && previewHits[0].includes('thread-abc123'), JSON.stringify(previewHits));
  check('shows the fetched snippet text', afterOpenDetail.snippet.includes('September statement'), afterOpenDetail.snippet);

  await page.click('.mb-inbox-row');
  await page.waitForTimeout(150);
  const afterCloseDetail = await page.evaluate(() => document.querySelector('.mb-inbox-detail').style.display);
  check('tapping again closes it without re-fetching', afterCloseDetail === 'none' && previewHits.length === 1);

  console.log('\n=== Archive removes the row immediately, no confirmation needed ===');
  await page.click('.mb-inbox-row');
  await page.waitForTimeout(150);
  await page.route('https://script.google.com/**', route => {
    const url = route.request().url();
    const body = route.request().postData();
    if (body && body.includes('emailAction')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: SAMPLE_BRIEF }) });
  });
  await page.click('.mb-inbox-action-btn:not(.mb-inbox-action-trash)');
  await page.waitForTimeout(400);
  const stillThere = await page.evaluate(() => !!document.querySelector('.mb-inbox-item'));
  check('the row is gone from the DOM after archiving, no dialog required', !stillThere);

  console.log('\n=== Trash asks for confirmation first ===');
  await page.unroute('https://script.google.com/**');
  await page.route('https://script.google.com/**', route => {
    const url = route.request().url();
    if (url.includes('action=loadMorningBrief') || url.includes('action=refreshMorningBriefNow')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: SAMPLE_BRIEF }) });
    }
    const body = route.request().postData();
    if (body && body.includes('emailAction')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' });
  });
  await page.click('#mbRefreshBtn');
  await page.waitForTimeout(300);
  let dialogSeen = false;
  page.once('dialog', d => { dialogSeen = true; d.dismiss(); });
  await page.click('.mb-inbox-row');
  await page.waitForTimeout(150);
  await page.click('.mb-inbox-action-trash');
  await page.waitForTimeout(200);
  const rowStillThereAfterDismiss = await page.evaluate(() => !!document.querySelector('.mb-inbox-item'));
  check('Trash triggers a confirmation dialog', dialogSeen);
  check('dismissing the confirmation keeps the row', rowStillThereAfterDismiss);

  page.once('dialog', d => d.accept());
  await page.click('.mb-inbox-action-trash');
  await page.waitForTimeout(400);
  const rowGoneAfterAccept = await page.evaluate(() => !!document.querySelector('.mb-inbox-item'));
  check('accepting the confirmation removes the row', !rowGoneAfterAccept);

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
  const bigTempMatch = afterRefresh.match(/mb-weather-temp">([^<]*)</);
  check('renders the freshly-regenerated data, not the stale cached value', bigTempMatch && bigTempMatch[1] === '88°F', bigTempMatch && bigTempMatch[1]);

  console.log('\n=== A section that failed server-side shows its real error, not a silent empty state ===');
  const BRIEF_WITH_ERRORS = {
    updatedAt: '2026-09-03T14:00:00Z',
    weather: SAMPLE_BRIEF.weather,
    _errors: { calendar: 'Exception: You do not have permission to call CalendarApp.getAllCalendars', inbox: 'Exception: You do not have permission to call GmailApp.search' }
  };
  await page.unroute('https://script.google.com/**');
  await page.route('https://script.google.com/**', route => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', brief: BRIEF_WITH_ERRORS }) });
  });
  await page.click('#mbRefreshBtn');
  await page.waitForTimeout(300);
  const withErrors = await page.evaluate(() => document.getElementById('mbContent').innerHTML);
  check('surfaces the calendar failure reason', withErrors.includes('You do not have permission to call CalendarApp'));
  check('surfaces the inbox failure reason', withErrors.includes('You do not have permission to call GmailApp'));
  check('still renders the sections that DID succeed', withErrors.includes('St. Petersburg, FL'));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
