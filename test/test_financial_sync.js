/* The financial plan follows you between devices.

   The failure mode that matters here is not "does it upload". It is the
   one the starter hit three separate times: a device that has not received
   the plan yet pushing its BLANK one over the real one, and the loss
   looking exactly like a success. So the sharp checks are:

     - a device that has never been edited never pushes,
     - the backend refuses an unstamped plan even if one is sent,
     - a newer plan from elsewhere is adopted, an older one is ignored,
     - and a refused write is SHOWN, not swallowed.

   The backend rule is last-write-wins rather than a field-by-field merge,
   which is deliberate: these numbers only mean anything as a set, and half
   of one device's retirement assumptions spliced into half of another's is
   a plan nobody chose. Part one checks that rule directly against code.gs;
   part two drives the real page against a stateful fake backend. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

/* ---------- Part one: the backend rule, straight out of code.gs ---------- */
function loadBackend(initial) {
  const store = {};
  if (initial !== undefined) store.FINANCIAL_STATE = JSON.stringify(initial);
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; }
    })
  };
  const src = fs.readFileSync(__dirname + '/../code.gs', 'utf8');
  const api = eval(src.replace(/^function doGet[\s\S]*$/m, '')
    + '\n;({ saveFinancialState_, loadFinancialState_, PROP_VALUE_LIMIT_BYTES })');
  return { store, ...api };
}

console.log('=== The stored plan is the most recently edited one ===');
{
  const older = { gross: 90000, savedAt: '2026-08-01T00:00:00.000Z' };
  const newer = { gross: 125000, savedAt: '2026-08-20T00:00:00.000Z' };

  let b = loadBackend(older);
  b.saveFinancialState_(newer);
  check('a newer plan replaces an older one',
    b.loadFinancialState_().gross === 125000, String(b.loadFinancialState_().gross));

  b = loadBackend(newer);
  b.saveFinancialState_(older);
  check('and an older one does not overwrite a newer one',
    b.loadFinancialState_().gross === 125000, String(b.loadFinancialState_().gross));
  check('the stored plan is handed back so the client can see what won',
    loadBackend(newer).saveFinancialState_(older).gross === 125000);

  /* The blank-device trap. An untouched plan carries no savedAt, and must
     be refused rather than quietly flattening real figures. */
  b = loadBackend(newer);
  let threw = '';
  try { b.saveFinancialState_({ gross: 95000 }); } catch (e) { threw = String(e.message || e); }
  check('a plan that was never edited is refused', /never edited/i.test(threw), threw);
  check('and the real plan is untouched by the attempt',
    b.loadFinancialState_().gross === 125000, String(b.loadFinancialState_().gross));

  b = loadBackend();
  check('nothing stored reads as nothing, not as a crash', b.loadFinancialState_() === null);
  b.saveFinancialState_(newer);
  check('and the first real plan lands', b.loadFinancialState_().gross === 125000);

  // 9 KB is a hard Script Property cap; past it the write throws and the
  // whole save is lost. Better a named error than a silent success.
  b = loadBackend();
  threw = '';
  try {
    b.saveFinancialState_({ savedAt: '2026-08-20T00:00:00.000Z',
      rewards: Array.from({ length: 900 }, (_, i) => ({ label: 'Cost number ' + i, amount: i })) });
  } catch (e) { threw = String(e.message || e); }
  check('an oversized plan fails loudly rather than storing nothing',
    /limit|bytes/i.test(threw), threw);
}

/* ---------- Part two: the page, against a stateful fake backend ---------- */
const BACKEND = 'https://script.google.com/macros/s/FAKE/exec';

// Serves and stores like the real endpoint, and records what it was asked
// to do so the test can assert on pushes that should never have happened.
async function wire(page, box) {
  await page.route('https://script.google.com/**', async route => {
    const req = route.request();
    const json = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'POST') {
      let data = {};
      try { data = JSON.parse(req.postData() || '{}'); } catch (e) {}
      if (data.action === 'saveFinancialState') {
        box.pushes.push(data.financial);
        const f = data.financial;
        if (!f || !f.savedAt) return json({ status: 'error', message: 'Refusing to store a plan that was never edited.' });
        if (box.stored && String(box.stored.savedAt) > String(f.savedAt)) return json({ status: 'success', financial: box.stored });
        box.stored = f;
        return json({ status: 'success', financial: f });
      }
      return json({ status: 'success' });
    }
    if (/action=loadFinancialState/.test(req.url())) {
      box.pulls++;
      return json({ status: 'success', financial: box.stored });
    }
    return json({ status: 'error' });
  });
}

const openFin = async page => {
  await page.waitForFunction(() => typeof showAppView === 'function'
    && typeof renderFinancialTab === 'function', null, { timeout: 15000 });
  await page.evaluate(() => showAppView('financial'));
  await page.waitForFunction(() => /median/.test(
    document.getElementById('finReadout').textContent || ''), null, { timeout: 15000 });
};

const seed = (page, fin) => page.addInitScript(([url, f]) => {
  localStorage.setItem('WORKOUT_DEPLOYMENT_URL', url);
  if (f) localStorage.setItem('FINANCIAL_FUTURE_STATE', JSON.stringify(f));
}, [BACKEND, fin]);

const syncLine = page => page.evaluate(() =>
  (document.getElementById('finSyncLine').textContent || '').trim());

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  console.log('\n=== An untouched device never pushes ===');
  {
    const box = { stored: { gross: 111111, savedAt: '2026-08-20T00:00:00.000Z' }, pushes: [], pulls: 0 };
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await wire(page, box);
    await seed(page);                       // no local plan at all
    await page.goto(URL);
    await openFin(page);
    await page.waitForTimeout(1200);

    check('it asked what the other device had', box.pulls > 0, `${box.pulls} pulls`);
    check('and pushed nothing over it', box.pushes.length === 0,
      JSON.stringify(box.pushes).slice(0, 120));
    check('the other device\'s plan was adopted',
      await page.evaluate(() => FIN.gross) === 111111,
      String(await page.evaluate(() => FIN.gross)));
    check('and the backend still holds it', box.stored.gross === 111111);
    await ctx.close();
  }

  console.log('\n=== Editing here reaches the other device ===');
  {
    const box = { stored: null, pushes: [], pulls: 0 };
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await wire(page, box);
    await seed(page);
    await page.goto(URL);
    await openFin(page);
    await page.evaluate(() => openFinancialEdit());
    await page.waitForTimeout(400);

    check('nothing is claimed before you have changed anything',
      (await syncLine(page)) === '', await syncLine(page));

    await page.fill('#fin_netWorth', '321000');
    await page.waitForTimeout(1800);
    check('the edit was pushed', box.stored && box.stored.netWorth === 321000,
      JSON.stringify(box.stored && box.stored.netWorth));
    check('and stamped with when it happened', !!(box.stored && box.stored.savedAt),
      box.stored && box.stored.savedAt);
    check('the line says so', /saved to your other devices/i.test(await syncLine(page)),
      await syncLine(page));

    /* A burst of typing must not become a request per keystroke - the
       backend is a single Apps Script deployment, not a write pipeline. */
    const before = box.pushes.length;
    for (const v of ['1', '12', '123', '1234', '12345']) {
      await page.fill('#fin_gross', v);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1800);
    check('typing five characters is one push, not five',
      box.pushes.length - before === 1, `${box.pushes.length - before} pushes`);

    // Rows are part of the plan too, not just the top-level fields.
    await page.evaluate(() => finAdd_('kid'));
    await page.waitForTimeout(1800);
    check('adding a child syncs as well',
      box.stored && (box.stored.kids || []).length === 1,
      JSON.stringify(box.stored && box.stored.kids));
    await ctx.close();
  }

  console.log('\n=== The newer plan wins, whichever device it came from ===');
  {
    // This device edited a while ago; the other one edited since.
    const mine = { netWorth: 50000, gross: 80000, savedAt: '2026-08-10T00:00:00.000Z' };
    const theirs = { netWorth: 777000, gross: 143000, savedAt: '2026-08-24T00:00:00.000Z' };
    const box = { stored: theirs, pushes: [], pulls: 0 };
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await wire(page, box);
    await seed(page, mine);
    await page.goto(URL);
    await openFin(page);
    await page.waitForTimeout(1500);

    const got = await page.evaluate(() => ({ nw: FIN.netWorth, g: FIN.gross }));
    check('the newer plan replaced this device\'s older one',
      got.nw === 777000 && got.g === 143000, JSON.stringify(got));
    check('it did not push the stale one back', box.pushes.length === 0,
      JSON.stringify(box.pushes).slice(0, 120));
    check('and it survives a reload here', await (async () => {
      await page.reload();
      await openFin(page);
      await page.waitForTimeout(800);
      return (await page.evaluate(() => FIN.netWorth)) === 777000;
    })());
    await ctx.close();
  }

  console.log('\n=== An older plan from elsewhere is ignored ===');
  {
    const mine = { netWorth: 654321, gross: 143000, savedAt: '2026-08-24T00:00:00.000Z' };
    const theirs = { netWorth: 1000, gross: 20000, savedAt: '2026-08-02T00:00:00.000Z' };
    const box = { stored: theirs, pushes: [], pulls: 0 };
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await wire(page, box);
    await seed(page, mine);
    await page.goto(URL);
    await openFin(page);
    await page.waitForTimeout(1500);
    check('this device keeps its newer figures',
      await page.evaluate(() => FIN.netWorth) === 654321,
      String(await page.evaluate(() => FIN.netWorth)));
    await ctx.close();
  }

  console.log('\n=== A save that did not land is visible ===');
  {
    /* The lesson the starter taught: the client only caught network
       errors, never the error the backend sent back, so a refused write
       looked exactly like a successful one. */
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await page.route('https://script.google.com/**', route => {
      const req = route.request();
      if (req.method() === 'POST') {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'error', message: 'FINANCIAL_STATE is 12000 bytes, over the limit - it was not saved.' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success' }) });   // an older deployment: no `financial` key
    });
    await seed(page);
    await page.goto(URL);
    await openFin(page);
    await page.evaluate(() => openFinancialEdit());
    await page.waitForTimeout(400);
    await page.fill('#fin_netWorth', '99000');
    await page.waitForTimeout(1800);
    const line = await syncLine(page);
    check('a refused write is reported, not swallowed', /⚠/.test(line), line);
    check('and it repeats the reason the backend gave', /not saved|bytes/i.test(line), line);
    check('the figure is still safe on this device',
      await page.evaluate(() => FIN.netWorth) === 99000);

    // Offline is a different message: nothing is wrong, it just has to wait.
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
    await page.fill('#fin_netWorth', '98000');
    await page.waitForTimeout(1500);
    check('offline says it will sync later rather than reporting a failure',
      /offline/i.test(await syncLine(page)), await syncLine(page));
    await ctx.close();
  }

  console.log('\n=== Resetting is an edit, so it does not come back ===');
  {
    const box = { stored: { netWorth: 500000, savedAt: '2026-08-20T00:00:00.000Z' }, pushes: [], pulls: 0 };
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => { console.log('  PAGEERROR', String(e).slice(0, 160)); fails++; });
    await wire(page, box);
    await seed(page, { netWorth: 500000, savedAt: '2026-08-20T00:00:00.000Z' });
    await page.goto(URL);
    await openFin(page);
    await page.evaluate(() => { window.confirm = () => true; finReset_(); });
    await page.waitForTimeout(1800);
    check('the reset was pushed, not just applied locally',
      box.stored && box.stored.netWorth === 48000,
      String(box.stored && box.stored.netWorth));
    check('so the next pull cannot restore what you cleared', await (async () => {
      await page.reload();
      await openFin(page);
      await page.waitForTimeout(1000);
      return (await page.evaluate(() => FIN.netWorth)) === 48000;
    })(), String(await page.evaluate(() => FIN.netWorth)));
    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
