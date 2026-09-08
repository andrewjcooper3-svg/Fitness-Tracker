/* A new Overview hero card for the sourdough starter, built to the same
   shape as the existing Pushups/Water cards: a headline number, a "of X"
   sub-line, a progress bar, a one-line status, and a chevron that expands
   to more detail - here the existing Kitchen-tab status card, reused
   rather than re-built, via buildStarterStatusHtml_(). Tapping the card
   body jumps straight to Kitchen's Starter subtab. */
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

  console.log('=== Not started yet ===');
  const none = await page.evaluate(() => {
    localStorage.removeItem('WORKOUT_KITCHEN_STARTER');
    renderOverviewStarterMini_();
    return {
      number: document.getElementById('ovStarterNumber').textContent,
      sub: document.getElementById('ovStarterSub').textContent,
      bar: document.getElementById('ovStarterBar').style.width,
      status: document.getElementById('ovStarterStatus').textContent
    };
  });
  check('shows a placeholder number', none.number === '—', none.number);
  check('sub says not started', none.sub === 'not started', none.sub);
  check('bar is empty', none.bar === '0%', none.bar);
  check('status prompts setup', none.status === 'Tap to set one up', none.status);

  console.log('\n=== Building (day 4 of 14) ===');
  const building = await page.evaluate(() => {
    const born = new Date(); born.setDate(born.getDate() - 3); born.setHours(0, 0, 0, 0);
    localStorage.setItem('WORKOUT_KITCHEN_STARTER', JSON.stringify({ stage: 'building', bornOn: born.toISOString(), build: {} }));
    renderOverviewStarterMini_();
    return {
      number: document.getElementById('ovStarterNumber').textContent,
      sub: document.getElementById('ovStarterSub').textContent,
      bar: document.getElementById('ovStarterBar').style.width
    };
  });
  check('shows the current build day', building.number === '4', building.number);
  check('sub says of 14 days', building.sub === 'of 14 days', building.sub);
  check('bar reflects day 4 of 14', building.bar === Math.round(4 / 14 * 100) + '%', building.bar);

  console.log('\n=== Active, no feed logged yet ===');
  const noFeed = await page.evaluate(() => {
    localStorage.setItem('WORKOUT_KITCHEN_STARTER', JSON.stringify({ stage: 'active', name: 'Doughy', location: 'counter', feeds: [] }));
    renderOverviewStarterMini_();
    return {
      number: document.getElementById('ovStarterNumber').textContent,
      status: document.getElementById('ovStarterStatus').textContent
    };
  });
  check('shows 0h with nothing logged', noFeed.number === '0h', noFeed.number);
  check('status prompts the first feed', noFeed.status === 'Log its first feed', noFeed.status);

  console.log('\n=== Active, fed ~20 hours ago ===');
  const fed = await page.evaluate(() => {
    const fedAt = new Date(); fedAt.setHours(fedAt.getHours() - 20);
    localStorage.setItem('WORKOUT_KITCHEN_STARTER', JSON.stringify({
      stage: 'active', name: 'Doughy', location: 'counter',
      feeds: [{ at: fedAt.toISOString(), tempF: 75, ratio: '1:1:1', flour: 'ap' }]
    }));
    document.getElementById('ovStarterChartWrap').dataset.restored = ''; // force the restore branch to re-check state
    renderOverviewStarterMini_();
    return {
      number: document.getElementById('ovStarterNumber').textContent,
      sub: document.getElementById('ovStarterSub').textContent,
      bar: parseInt(document.getElementById('ovStarterBar').style.width, 10),
      status: document.getElementById('ovStarterStatus').textContent
    };
  });
  check('the number reads ~20h since the feed', fed.number === '20h', fed.number);
  check('the sub shows the interval it is tracking toward', /^of ~\d+h$/.test(fed.sub), fed.sub);
  check('the bar is filled somewhere between empty and full', fed.bar > 0 && fed.bar <= 100, fed.bar);
  check('the status line carries a feed-cycle badge', /Fed|Due soon|Feed it|Overdue/.test(fed.status), fed.status);

  console.log('\n=== The chevron expands the same status card Kitchen shows ===');
  const expand = await page.evaluate(() => {
    const before = document.getElementById('ovStarterChartWrap').classList.contains('expanded');
    toggleStarterChart_();
    return {
      before,
      after: document.getElementById('ovStarterChartWrap').classList.contains('expanded'),
      chevron: document.getElementById('ovStarterChevron').textContent,
      hasStatusCard: document.querySelector('#ovStarterStatusHost .sd-status') !== null
    };
  });
  check('expanding toggles the wrap open', !expand.before && expand.after, JSON.stringify(expand));
  check('the chevron flips to open', expand.chevron === '▾', expand.chevron);
  check('the expanded detail reuses the real status card', expand.hasStatusCard);

  console.log('\n=== Tapping the card jumps to Kitchen\'s Starter subtab ===');
  await page.evaluate(() => { document.querySelector('.ov-hero-starter').click(); });
  await page.waitForTimeout(300);
  const nav = await page.evaluate(() => ({
    onKitchen: viewOrder[currentViewIndex] === 'kitchen',
    starterVisible: document.getElementById('kitchenSectionStarter').style.display !== 'none',
    subtabActive: document.querySelector('.kitchen-subtab[data-section="starter"]').classList.contains('active')
  }));
  check('navigated to the Kitchen tab', nav.onKitchen, JSON.stringify(nav));
  check('landed directly on the Starter subtab', nav.starterVisible && nav.subtabActive, JSON.stringify(nav));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
