/* No view carries a page title any more.

   The tab bar names the tab; a heading repeating it underneath was a row of
   chrome on every screen. What this guards is the part that is easy to get
   wrong when you delete a header: the CONTROLS it was holding. Overview's
   gear is the only route to Settings, and History's arrange and refresh
   buttons had no other home - so this checks each one is still on screen
   and still clickable, not just that the titles are gone.

   The budgets are absolute, measured when the change shipped, so a later
   change that spends the space again fails here. */
const { chromium } = require('playwright');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

// view, label, selector, max y of the first real content.
const VIEWS = [
  ['stats', 'History', '#view-stats', 92],
  ['bodyhealth', 'Health', '#view-bodyhealth', 70],
  ['kitchen', 'Kitchen', '#view-kitchen', 72],
  ['overview', 'Overview', '#view-overview', 84]
];

// bodyhealth has no tab of its own, so reveal it the way the app would.
const show = (page, view) => page.evaluate(v => {
  if (v === 'bodyhealth') {
    document.querySelectorAll('.app-view').forEach(el => el.classList.remove('active'));
    const el = document.getElementById('view-bodyhealth');
    el.classList.add('active'); el.style.display = 'block';
  } else { showAppView(v); }
}, view);

const probe = (page, sel) => page.evaluate(s => {
  const view = document.querySelector(s);
  // The first thing in the view that actually occupies space.
  let first = null;
  for (const el of view.children) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) { first = { top: Math.round(r.top), cls: el.className }; break; }
  }
  return {
    titles: [...view.querySelectorAll(':scope > .ov-page-head .ov-page-title')].map(t => t.textContent.trim()),
    first
  };
}, sel);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForTimeout(900);

  console.log('=== No tab shows a page title ===');
  for (const [view, label, sel, maxTop] of VIEWS) {
    await show(page, view);
    await page.waitForTimeout(350);
    const p = await probe(page, sel);
    check(`${label}: no title heading`, p.titles.length === 0, p.titles.join(', '));
    check(`${label}: content starts by y=${maxTop}`, p.first && p.first.top <= maxTop,
      p.first ? `y=${p.first.top} (${p.first.cls})` : 'nothing visible');
  }

  console.log('\n=== The tab bar still names the tab ===');
  const tabs = await page.evaluate(() => {
    const bar = document.querySelector('.app-tabs');
    return {
      visible: !!bar && bar.getBoundingClientRect().height > 0,
      labels: [...document.querySelectorAll('.app-tab .app-tab-label')].map(t => t.textContent.trim()),
      active: (document.querySelector('.app-tab.active .app-tab-label') || {}).textContent
    };
  });
  check('the top tab bar is untouched', tabs.visible && tabs.labels.length >= 5, tabs.labels.join(', '));
  check('and marks the tab you are on', /overview/i.test(tabs.active || ''), tabs.active);

  console.log('\n=== Deleting a header stranded no control ===');
  // Overview's gear is the ONLY way into Settings.
  await show(page, 'overview');
  await page.waitForTimeout(350);
  for (const [sel, what] of [['#ovEditBtn', 'Edit']]) {
    check(`Overview keeps ${what}`, await page.isVisible(sel));
  }
  const ovBtns = await page.evaluate(() =>
    [...document.querySelectorAll('#view-overview .ov-page-head-actions button')]
      .filter(b => b.getBoundingClientRect().height > 0)
      .map(b => (b.getAttribute('aria-label') || b.textContent).trim()));
  check('Overview keeps all three actions', ovBtns.length === 3, ovBtns.join(', '));
  await page.click('#view-overview .ov-page-head-actions button[aria-label="Settings"]');
  await page.waitForTimeout(400);
  check('the gear still opens Settings', await page.evaluate(() =>
    document.getElementById('settingsModalOverlay').classList.contains('open')));
  await page.evaluate(() => closeSettingsModal());
  await page.waitForTimeout(300);
  check('Overview keeps its live week label', await page.evaluate(() =>
    (document.getElementById('ovWeekLabel').textContent || '').trim().length > 0));

  await show(page, 'stats');
  await page.waitForTimeout(400);
  check('History keeps Arrange', await page.isVisible('#hxLayoutBtn'));
  check('History keeps Refresh', await page.isVisible('#hxRefreshBtn'));
  check('both sit on the range row', await page.evaluate(() =>
    !!document.querySelector('#hxRange .hx-range-actions #hxLayoutBtn')));
  await page.click('#hxLayoutBtn');
  await page.waitForTimeout(400);
  check('Arrange still opens the editor', await page.evaluate(() =>
    document.getElementById('hxLayoutOverlay').classList.contains('open')));
  await page.evaluate(() => closeHistoryLayout());
  await page.waitForTimeout(250);
  // ...and it is still Overview-only.
  await page.evaluate(() => showHistorySection('workouts'));
  await page.waitForTimeout(300);
  check('Arrange hides on segments with no cards', !(await page.isVisible('#hxLayoutBtn')));
  check('Refresh stays, since it reloads the whole tab', await page.isVisible('#hxRefreshBtn'));
  await page.evaluate(() => showHistorySection('overview'));

  console.log('\n=== Modal sheets keep their titles ===');
  const modalTitle = await page.evaluate(() => {
    const el = document.querySelector('#muscleBalanceOverlay .ov-page-title');
    return el ? { text: el.textContent.trim(), px: Math.round(parseFloat(getComputedStyle(el).fontSize)) } : null;
  });
  check('a sheet still has a heading', modalTitle && modalTitle.text.length > 0, modalTitle && modalTitle.text);
  check('and it is still 28px', modalTitle && modalTitle.px === 28, modalTitle && String(modalTitle.px));

  console.log('\n=== Nothing overflows ===');
  for (const [view, label] of VIEWS) {
    await show(page, view);
    await page.waitForTimeout(300);
    check(`${label} does not scroll sideways`, !(await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  }

  await ctx.close();
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
