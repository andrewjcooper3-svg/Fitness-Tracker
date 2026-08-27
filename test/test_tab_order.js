/* Reordering the tabs themselves, from Settings.

   viewOrder drives the swipe carousel (goToView translates by
   -index*100%, and each view's CSS `order:` maps it onto that index
   regardless of DOM position) - so reordering has to touch three things
   in lockstep: the array itself, the view divs' CSS order, and the nav
   buttons (tab bar + sidebar) so what you tap matches what you land on.

   What is checked here:
     - the settings list shows every tab, and the ends can't move past
       themselves,
     - moving a tab updates viewOrder, persists it, and re-homes the
       view divs' CSS order AND the actual nav button DOM order together -
       a mismatch between any of these is what would send a tap to the
       wrong page,
     - switching tabs after a reorder still lands the carousel in the
       right place,
     - Reset clears the override,
     - a saved order that predates a newer tab (like Routines) appends it
       rather than dropping it silently. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
const DEFAULT_ORDER = ['overview', 'tracker', 'kitchen', 'music', 'calendar', 'stats', 'financial', 'routines'];
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('=== Settings shows every tab, ends cannot move past themselves ===');
  await page.evaluate(() => openSettingsModal());
  await page.waitForTimeout(200);
  const labels = await page.evaluate(() => [...document.querySelectorAll('#tabOrderList .hx-layout-name span')].map(s => s.textContent));
  check('all 8 tabs are listed', labels.length === 8, JSON.stringify(labels));
  const upDisabled = await page.evaluate(() => document.querySelector('#tabOrderList .hx-layout-row .hx-layout-move[aria-label="Move up"]').disabled);
  const downDisabled = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tabOrderList .hx-layout-row')];
    return rows[rows.length - 1].querySelector('.hx-layout-move[aria-label="Move down"]').disabled;
  });
  check('the first row cannot move up, the last cannot move down', upDisabled && downDisabled);

  console.log('\n=== Moving a tab keeps the array, CSS order, and nav buttons in lockstep ===');
  await page.evaluate(() => { for (let i = 0; i < 7; i++) moveTabOrder('routines', -1); });
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => ({
    viewOrder: viewOrder.slice(),
    saved: JSON.parse(localStorage.getItem('WORKOUT_TAB_ORDER')),
    cssOrder: viewOrder.map(v => document.getElementById('view-' + v).style.order),
    tabBar: [...document.querySelectorAll('#appTabs .app-tab')].map(t => t.dataset.view).filter(v => v !== 'bodyhealth'),
    sidebar: [...document.querySelectorAll('#appSidebar .app-sidebar-item')].map(t => t.dataset.view)
  }));
  check('viewOrder puts Routines first', state.viewOrder[0] === 'routines', JSON.stringify(state.viewOrder));
  check('the new order was persisted', state.saved[0] === 'routines', JSON.stringify(state.saved));
  check('each view div\'s CSS order matches its new index', state.cssOrder.every((o, i) => Number(o) === i), JSON.stringify(state.cssOrder));
  check('the tab bar buttons themselves were physically reordered to match', state.tabBar[0] === 'routines', JSON.stringify(state.tabBar));
  check('the sidebar items were reordered to match', state.sidebar[0] === 'routines', JSON.stringify(state.sidebar));

  console.log('\n=== Switching tabs after a reorder still lands correctly ===');
  await page.evaluate(() => showAppView('tracker'));
  await page.waitForTimeout(250);
  const nav = await page.evaluate(() => {
    const idx = viewOrder.indexOf('tracker');
    return {
      transform: document.getElementById('appViewsTrack').style.transform,
      expected: `translateX(${-idx * 100}%)`,
      activeTab: document.querySelector('.app-tab.active').dataset.view
    };
  });
  check('the carousel translates to the correct new index', nav.transform === nav.expected, JSON.stringify(nav));
  check('the right tab is marked active', nav.activeTab === 'tracker');

  console.log('\n=== Reset and reconciliation ===');
  await page.evaluate(() => resetTabOrder());
  const afterReset = await page.evaluate(() => ({ order: viewOrder.slice(), stored: localStorage.getItem('WORKOUT_TAB_ORDER') }));
  check('reset restores the default order', JSON.stringify(afterReset.order) === JSON.stringify(DEFAULT_ORDER), JSON.stringify(afterReset.order));
  check('reset clears the stored override', afterReset.stored === null);

  const reconciled = await page.evaluate(() => {
    // Simulate an order saved before "routines" existed.
    localStorage.setItem('WORKOUT_TAB_ORDER', JSON.stringify(['financial', 'overview', 'tracker', 'kitchen', 'music', 'calendar', 'stats']));
    applyTabOrder_();
    return viewOrder.slice();
  });
  check('a tab missing from a stale saved order is appended, not dropped', reconciled.length === 8 && reconciled.includes('routines'), JSON.stringify(reconciled));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
