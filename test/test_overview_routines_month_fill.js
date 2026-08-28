/* At >=768px the Routines hero card's calendar box is stretched (by
   align-items:stretch) to match the habit list's height, but Month view's
   grid used to just sit at its own small natural content size inside that
   box, leaving a chunk of blank white space below it. ovFillMonthFlow_
   (Workout_Tracker_AutoLog.html) now measures that box and picks column/
   row track counts that divide it exactly, staying as close to square as
   the box allows, and redoes this on resize/orientation change since it's
   driven by measurement rather than fixed math.

   What is checked here:
     - on a narrow screen, the grid still uses the plain CSS auto-fill
       sizing (no inline track override) - this fill behavior is wide-only,
     - at wide layout, Month's grid has no leftover gap: its rendered
       height matches the calendar box's available height, and its
       rendered width matches the box's width,
     - the resulting cells are reasonably square (not squished into thin
       bars), since a tall grid with too few rows would produce that,
     - resizing from wide to narrow clears the inline track override so
       the original compact width-fill behavior takes back over,
     - resizing from narrow to wide (re-)applies the fill. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  check('no page errors on load', errors.length === 0, errors.join(' | '));

  await page.evaluate(() => {
    showAppView('routines');
    ['Drink Water', 'Make Bed', 'Weigh Myself', 'Waterfloss'].forEach(n => {
      rtOpenHabitSheet();
      document.getElementById('rtHName').value = n;
      rtSetCadence('daily');
      rtSaveHabit();
    });
    showAppView('overview');
    setOvRoutinesCalMode('month');
  });
  await page.waitForTimeout(300);

  const wideFill = await page.evaluate(() => {
    const wrap = document.getElementById('ovRoutinesCalWrap');
    const seg = document.getElementById('ovRoutinesCalSeg');
    const grid = document.getElementById('ovRoutinesCalGrid');
    const flow = document.querySelector('.ov-month-flow');
    const sq = document.querySelector('.ov-month-sq');
    const wrapR = wrap.getBoundingClientRect(), gridR = grid.getBoundingClientRect(), flowR = flow.getBoundingClientRect();
    return {
      hasInlineTemplate: !!flow.style.gridTemplateColumns,
      flowW: flowR.width, flowH: flowR.height,
      availW: wrapR.width, availH: gridR.height,
      sqW: sq.getBoundingClientRect().width, sqH: sq.getBoundingClientRect().height
    };
  });
  check('at wide layout Month sets an explicit fill track (not left to plain auto-fill)', wideFill.hasInlineTemplate, JSON.stringify(wideFill));
  check('the grid\'s width matches the box\'s available width (no leftover gap)',
    Math.abs(wideFill.flowW - wideFill.availW) < 2, JSON.stringify(wideFill));
  check('the grid\'s height matches the box\'s available height (no leftover gap below it)',
    Math.abs(wideFill.flowH - wideFill.availH) < 2, JSON.stringify(wideFill));
  check('cells are reasonably square, not squished into thin bars',
    wideFill.sqW / wideFill.sqH > 0.4 && wideFill.sqW / wideFill.sqH < 2.5, JSON.stringify(wideFill));

  console.log('\n=== Resizing to narrow clears the wide-only fill override ===');
  await page.setViewportSize({ width: 390, height: 950 });
  await page.waitForTimeout(400);
  const narrowAfterResize = await page.evaluate(() => {
    const flow = document.querySelector('.ov-month-flow');
    return { inlineCols: flow.style.gridTemplateColumns, inlineRows: flow.style.gridTemplateRows };
  });
  check('the inline track override is cleared, falling back to plain width-fill', !narrowAfterResize.inlineCols && !narrowAfterResize.inlineRows, JSON.stringify(narrowAfterResize));

  console.log('\n=== Resizing back to wide re-applies the fill ===');
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(400);
  const wideAgain = await page.evaluate(() => !!document.querySelector('.ov-month-flow').style.gridTemplateColumns);
  check('the fill override comes back once wide again', wideAgain);

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
