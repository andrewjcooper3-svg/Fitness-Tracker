/* buildPayload() is what actually reaches the Sheet (via submitWorkout) -
   it used to omit the day's "general notes" textarea entirely, so typing
   sleep/soreness/energy notes and hitting "Generate Summary" showed them
   in the on-screen summary and clipboard copy, but they never left the
   browser. This checks the payload actually sent carries them, for a day
   with logged exercises (the common case) and for one with none (the
   pre-existing rest-day path, which already worked and must keep working). */
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
  await page.waitForFunction(() => typeof buildPayload === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  console.log('=== buildPayload() carries the day-notes textarea to the Sheet payload ===');
  const withNotes = await page.evaluate(() => {
    const ta = document.querySelector('#day-mon .day-notes-input');
    ta.value = 'Slept badly, knee felt tight on squats.';
    return buildPayload('mon');
  });
  check('the payload has a notes field', typeof withNotes.notes === 'string', JSON.stringify(withNotes.notes));
  check('it carries exactly what was typed', withNotes.notes === 'Slept badly, knee felt tight on squats.', withNotes.notes);

  const emptyNotes = await page.evaluate(() => {
    document.querySelector('#day-tue .day-notes-input').value = '';
    return buildPayload('tue');
  });
  check('an untouched day sends an empty string, not undefined', emptyNotes.notes === '', JSON.stringify(emptyNotes.notes));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
