/* The tab headers, after dropping the eyebrow line and shrinking the title.

   The assertion that matters is not "the title is 22px" - it is that the
   CONTENT SITS HIGH. A header can lose a line and gain it back in padding,
   which measures as a change and reclaims nothing. This was originally
   written to diff the working tree against the previous commit; once that
   commit landed the diff went to zero and the test passed vacuously, so the
   budgets below are absolute - measured at the point the change shipped,
   and they fail if a later change spends the space again.

   Also pinned: no tab lost its title or its buttons, Overview keeps its
   week label (a live date, not a restatement of the title), and the modal
   sheets - which share these class names - did NOT shrink with them. */
const { chromium } = require('playwright');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

// bodyhealth is not in viewOrder (its tab is display:none), so it is shown
// directly rather than through the tab bar.
/* view, title, selector, max header height, max y of the first content.
   Overview is allowed more: its eyebrow is the live week label and stays. */
const VIEWS = [
  ['stats', 'History', '#view-stats', 52, 110],
  ['bodyhealth', 'Health', '#view-bodyhealth', 48, 106],
  ['kitchen', 'Kitchen', '#view-kitchen', 64, 122],
  ['overview', 'Overview', '#view-overview', 68, 115]
];

const measure = (page, sel) => page.evaluate(s => {
  const view = document.querySelector(s);
  const h = view.querySelector(':scope > .ov-page-head');
  if (!h) return null;
  const t = h.querySelector('.ov-page-title');
  const eyebrow = h.querySelector('.ov-page-week');
  let next = h.nextElementSibling;
  while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
  return {
    height: Math.round(h.getBoundingClientRect().height),
    title: t ? t.textContent.trim() : null,
    titlePx: t ? Math.round(parseFloat(getComputedStyle(t).fontSize)) : null,
    eyebrow: eyebrow ? eyebrow.textContent.trim() : null,
    buttons: h.querySelectorAll('button').length,
    contentTop: next ? Math.round(next.getBoundingClientRect().top) : null
  };
}, sel);

// bodyhealth has no tab, so reveal it the way the app would if it did.
const show = (page, view) => page.evaluate(v => {
  if (v === 'bodyhealth') {
    document.querySelectorAll('.app-view').forEach(el => el.classList.remove('active'));
    const el = document.getElementById('view-bodyhealth');
    el.classList.add('active'); el.style.display = 'block';
  } else { showAppView(v); }
}, view);

async function sweep(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(url);
  await page.waitForTimeout(900);
  const out = {};
  for (const [view, title, sel] of VIEWS) {
    await show(page, view);
    await page.waitForTimeout(350);
    out[title] = await measure(page, sel);
  }
  const modalPx = await page.evaluate(() => {
    const el = document.querySelector('#muscleBalanceOverlay .ov-page-title');
    return el ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : null;
  });
  await ctx.close();
  return { out, modalPx, page: null };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const now = await sweep(browser, URL);

  console.log('=== The header stays out of the way ===');
  for (const [, title, , maxH, maxTop] of VIEWS) {
    const a = now.out[title];
    if (!a || a.contentTop == null) { check(`${title}: measurable`, false); continue; }
    check(`${title}: header within ${maxH}px`, a.height <= maxH, `${a.height}px`);
    check(`${title}: content starts by y=${maxTop}`, a.contentTop <= maxTop, `y=${a.contentTop}`);
  }

  console.log('\n=== Each tab keeps its title and its controls ===');
  for (const [, title] of VIEWS) {
    const a = now.out[title];
    check(`${title}: title still reads "${title}"`, a && a.title === title, a && a.title);
    check(`${title}: title is 22px`, a && a.titlePx === 22, a && String(a.titlePx));
  }

  console.log('\n=== The eyebrow that only restated the title is gone ===');
  ['History', 'Health', 'Kitchen'].forEach(title => {
    check(`${title} has no eyebrow`, now.out[title].eyebrow === null, now.out[title].eyebrow);
  });
  // Overview's is a live week label, so removing it would cost information
  // rather than chrome.
  check('Overview keeps its week label', now.out.Overview.eyebrow !== null, now.out.Overview.eyebrow);

  console.log('\n=== Nothing was stranded ===');
  check('History still has both header buttons', now.out.History.buttons === 2,
    String(now.out.History.buttons));

  console.log('\n=== Modal sheets kept their own weight ===');
  check('a sheet title is still 28px', now.modalPx === 28, String(now.modalPx));

  console.log('\n=== Nothing overflows ===');
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForTimeout(900);
  for (const [view, title] of VIEWS) {
    await show(page, view);
    await page.waitForTimeout(300);
    check(`${title} does not scroll sideways`, !(await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  }
  await ctx.close();

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
