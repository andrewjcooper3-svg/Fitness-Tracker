/* The Starter tab folds, and the status card opens the feed form.

   Two things worth guarding, and neither is "does a chevron flip":

   1. The open/closed set has to SURVIVE A RELOAD, and it has to be applied
      from state on every render. The tab repaints itself on a timer, so a
      section that folds by flipping a class alone comes back unfolded a
      minute later - which is how tidying a long page silently undoes
      itself.

   2. The status card's button used to write a feed straight to the log
      using last time's details. It now has to OPEN A FORM instead, with
      the time set to now and nothing written yet. The failure that matters
      is the invisible one: a tap that quietly banks a guessed feed. So
      this asserts the feed count is UNCHANGED after the tap, and only
      moves after the form is submitted.

   The form is moved into the sheet rather than copied, so the third thing
   checked is that it comes home: after submit, and after cancel, the
   inputs must be back inside the section - a form left inside a closed
   overlay is gone until reload, and the fields renderStarter() writes its
   defaults into would be the invisible copy. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

// An established starter with one feed eight hours ago - enough for the
// status card to show its actions and for the check box to appear.
const starter = () => ({
  stage: 'active', name: 'Doughy', bornOn: new Date(Date.now() - 90 * 86400000).toISOString(),
  build: {}, location: 'counter', ratio: '1:2:2', flour: 'bread', keepG: 50, tempF: 72,
  feeds: [{ id: 'f1', at: new Date(Date.now() - 8 * 3600000).toISOString(),
            keepG: 50, ratio: '1:2:2', flour: 'bread', tempF: 72, location: 'counter', checks: [] }]
});

// Every foldable section on the tab, by the key its body/chevron share.
const SECTIONS = ['sdWhere', 'sdFeed', 'sdCheck', 'sdGap', 'sdPlan2', 'sdHist', 'sdRef'];

const openState = page => page.evaluate(keys => Object.fromEntries(keys.map(k => {
  const body = document.getElementById(k + 'Body');
  const chev = document.getElementById(k + 'Chevron');
  return [k, {
    open: !!body && body.classList.contains('expanded'),
    tall: !!body && body.getBoundingClientRect().height > 0,
    mark: chev ? chev.textContent.trim() : null
  }];
})), SECTIONS);

const feedCount = page => page.evaluate(() => (loadStarter_().feeds || []).length);

async function openStarter(page) {
  await page.waitForFunction(() => typeof showAppView === 'function'
    && typeof showKitchenSection === 'function' && typeof renderStarter === 'function',
    null, { timeout: 15000 });
  await page.evaluate(() => { showAppView('kitchen'); showKitchenSection('starter'); });
  await page.waitForFunction(() => {
    const el = document.getElementById('sdActive');
    return el && el.getBoundingClientRect().height > 0;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [w, h, tag] of [[430, 932, 'phone'], [1400, 900, 'desktop']]) {
    console.log(`\n=== ${tag} (${w}x${h}) ===`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e)); fails++; });
    await page.route('https://script.google.com/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await page.addInitScript(st => {
      localStorage.setItem('WORKOUT_KITCHEN_STARTER', JSON.stringify(st));
    }, starter());

    await page.goto(URL);
    await openStarter(page);

    console.log('-- every section folds --');
    let state = await openState(page);
    const missing = SECTIONS.filter(k => state[k].mark === null);
    check('each section has a chevron', missing.length === 0, missing.join(', '));

    // The default: the two you reach for are open, reference material is not.
    check('a first visit is not a wall of open boxes',
      SECTIONS.filter(k => state[k].open).length <= 3,
      SECTIONS.filter(k => state[k].open).join(', '));

    // Fold every one of them, one at a time.
    for (const k of SECTIONS) await page.evaluate(key => toggleStarterSection(key, false), k);
    await page.waitForTimeout(250);
    state = await openState(page);
    const stuck = SECTIONS.filter(k => state[k].open || state[k].tall);
    check('all of them close', stuck.length === 0, stuck.join(', '));
    const wrongMark = SECTIONS.filter(k => state[k].mark !== '▸');
    check('and the chevrons say so', wrongMark.length === 0, wrongMark.join(', '));

    // Open two, then force the repaint the tab does on its own timer.
    await page.evaluate(() => { toggleStarterSection('sdHist', true); toggleStarterSection('sdRef', true); });
    await page.waitForTimeout(200);
    await page.evaluate(() => renderStarter());
    await page.waitForTimeout(250);
    state = await openState(page);
    check('a re-render does not unfold what you closed',
      state.sdHist.open && state.sdRef.open && !state.sdWhere.open && !state.sdGap.open,
      SECTIONS.filter(k => state[k].open).join(', '));

    console.log('\n-- and remembers it --');
    await page.reload();
    await openStarter(page);
    state = await openState(page);
    check('the open set survives a reload',
      state.sdHist.open && state.sdRef.open, SECTIONS.filter(k => state[k].open).join(', '));
    check('and so does what was closed',
      !state.sdWhere.open && !state.sdCheck.open && !state.sdFeed.open,
      SECTIONS.filter(k => state[k].open).join(', '));

    console.log('\n-- the status card opens the form, it does not log --');
    const before = await feedCount(page);
    await page.click('#sdStatusHost .sd-status-actions button');
    await page.waitForTimeout(350);
    check('the sheet opens', await page.evaluate(() =>
      document.getElementById('sdFeedOverlay').classList.contains('open')));
    check('the real form is inside it', await page.evaluate(() =>
      document.getElementById('sdFeedModalHost').contains(document.getElementById('sdFeedKeep'))));
    check('nothing was logged by opening it', (await feedCount(page)) === before,
      `${before} -> ${await feedCount(page)}`);
    const t = await page.inputValue('#sdFeedTime');
    const now = await page.evaluate(() => {
      const d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    });
    check('the time is set to now', t === now, `${t} vs ${now}`);
    check('the defaults came with it', await page.inputValue('#sdFeedKeep') === '50',
      await page.inputValue('#sdFeedKeep'));

    console.log('\n-- cancelling changes nothing and gives the form back --');
    await page.click('#sdFeedOverlay .event-modal-close');
    await page.waitForTimeout(300);
    check('the sheet closes', !(await page.evaluate(() =>
      document.getElementById('sdFeedOverlay').classList.contains('open'))));
    check('the form is back in the section', await page.evaluate(() =>
      document.getElementById('sdFeedBody').contains(document.getElementById('sdFeedKeep'))));
    check('and still nothing logged', (await feedCount(page)) === before);

    console.log('\n-- submitting from the sheet does log --');
    await page.click('#sdStatusHost .sd-status-actions button');
    await page.waitForTimeout(300);
    await page.fill('#sdFeedKeep', '75');
    await page.click('#sdFeedModalHost button.sd-btn');
    await page.waitForTimeout(400);
    check('the feed is on record', (await feedCount(page)) === before + 1,
      `${before} -> ${await feedCount(page)}`);
    check('with the amount you typed', await page.evaluate(() => {
      const f = loadStarter_().feeds.slice(-1)[0];
      return Number(f.keepG);
    }) === 75);
    check('the sheet closed itself', !(await page.evaluate(() =>
      document.getElementById('sdFeedOverlay').classList.contains('open'))));
    check('and the form came home', await page.evaluate(() =>
      document.getElementById('sdFeedBody').contains(document.getElementById('sdFeedKeep'))));

    // The repaint after a submit writes defaults into these inputs. If the
    // form were still in the overlay it would be writing into nothing.
    await page.evaluate(() => renderStarter());
    await page.waitForTimeout(250);
    check('the section still owns the inputs after a repaint', await page.evaluate(() =>
      document.getElementById('sdFeedBody').contains(document.getElementById('sdFeedRatio'))));

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('the page does not scroll sideways', !overflow);

    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
