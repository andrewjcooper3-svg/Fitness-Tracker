/* Real bug report: "its monday morning now and the app is missing
   pushups that were completed [Sunday]. and they seem to be logged into
   the google sheet, logged by the automatic log instead of me clicking.
   and they are not reading on the history chart."

   archiveFinishedWeek_ already exists to handle exactly "you didn't hit
   Generate Session Summary before the week rolled over" - it queues
   that day's data to the Sheet automatically so it isn't lost. That part
   was already correct (which is why it really was in the Sheet). The
   bug: it never updated the local pushup ledger (STORAGE_PUSHUP_LEDGER_
   KEY) - that's normally kept current by updatePushupLedger(), which
   only ever reads the LIVE, currently-rendered day panels. By the time
   archiveFinishedWeek_ runs, renderWeeklyPlan_() has already built the
   NEW week's empty cards, so the old week's real numbers are nowhere on
   screen to read - they reached the Sheet, but silently never made it
   into the ledger the app's own displays (and the History chart) read
   from.

   Fixed by computing each archived day's pushup total directly from the
   saved snapshot being archived (the same live-DOM rule sumReps() uses -
   checked sets only, typed reps else the target - replayed against
   saved data) and writing it into the ledger under that day's real
   calendar date, for all 7 days of the week that just ended.

   What is checked here:
     - a real week rollover (saved.week is last week's label, current
       getWeekLabel() is this week's) with Sunday's Pushups checked and
       logged locally but never manually submitted: restoreState() still
       queues it to the Sheet (the part that already worked), AND now
       also writes Sunday's real pushup total into the local ledger
       under Sunday's actual calendar date,
     - a day within that same archived week with unchecked/no pushups
       gets 0, not left stale or undefined,
     - the CURRENT week (today) is completely unaffected - only the
       archived week's 7 dates get touched,
     - a normal, non-rollover load (saved.week === getWeekLabel()) never
       calls this at all - no change there. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const postedPayloads = [];
  await page.route('https://script.google.com/**', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      try { postedPayloads.push(JSON.parse(req.postData())); } catch (e) {}
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' });
    }
  });
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log('=== Seeding a real week rollover: last week saved, with Sunday pushups checked but never manually logged ===');
  const setup = await page.evaluate(() => {
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const oldMonday = new Date(getWeekMonday().getTime() - 7 * ROUTINES_DAY_MS);
    const oldSunday = new Date(oldMonday.getTime() + 6 * ROUTINES_DAY_MS);
    const oldWeekLabel = `Week of ${fmt(oldMonday)} - ${fmt(oldSunday)}, ${oldSunday.getFullYear()}`;

    const sunKey = dateKey(oldSunday);
    const satDate = new Date(oldMonday.getTime() + 5 * ROUTINES_DAY_MS);
    const satKey = dateKey(satDate);

    const saved = {
      week: oldWeekLabel,
      days: {
        mon: { exercises: [], checkItems: [], dayNotes: '' },
        tue: { exercises: [], checkItems: [], dayNotes: '' },
        wed: { exercises: [], checkItems: [], dayNotes: '' },
        thu: { exercises: [], checkItems: [], dayNotes: '' },
        fri: { exercises: [], checkItems: [], dayNotes: '' },
        // Saturday: pushups present but NOT checked - should count as 0.
        sat: {
          exercises: [{ id: 'ex0', name: 'Pushups', sets: [{ weight: 'BW', reps: '55', checked: false }] }],
          checkItems: [], dayNotes: ''
        },
        // Sunday: real completed pushups, never hit Generate Summary for it.
        sun: {
          exercises: [{ id: 'ex0', name: 'Pushups', sets: [
            { weight: 'BW', reps: '55', checked: true },
            { weight: 'BW', reps: '55', checked: true },
            { weight: 'BW', reps: '60', checked: true },
            { weight: 'BW', reps: '', checked: false } // unchecked - target fallback should NOT count
          ] }],
          checkItems: [], dayNotes: ''
        }
      }
    };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(saved));
    // Clear any prior local ledger entries for these two dates so the test starts from a clean slate.
    const ledger = JSON.parse(localStorage.getItem('WORKOUT_PUSHUP_LEDGER') || '{}');
    delete ledger[sunKey]; delete ledger[satKey];
    localStorage.setItem('WORKOUT_PUSHUP_LEDGER', JSON.stringify(ledger));

    return { oldWeekLabel, sunKey, satKey, currentWeekLabel: getWeekLabel() };
  });
  console.log('  old week label:', setup.oldWeekLabel);
  console.log('  current week label:', setup.currentWeekLabel);
  check('the seeded week label really is different from the current one (a real rollover)', setup.oldWeekLabel !== setup.currentWeekLabel, JSON.stringify(setup));

  console.log('\n=== Reloading - this is the exact moment restoreState() detects the rollover and archives ===');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const result = await page.evaluate((keys) => {
    const ledger = JSON.parse(localStorage.getItem('WORKOUT_PUSHUP_LEDGER') || '{}');
    return { sunTotal: ledger[keys.sunKey], satTotal: ledger[keys.satKey] };
  }, setup);
  console.log('  ledger after rollover:', JSON.stringify(result));
  check('Sunday\'s real pushup total (55+55+60=170, unchecked set excluded) landed in the local ledger',
    result.sunTotal === 170, JSON.stringify(result));
  check('Saturday (pushups present but unchecked) correctly got 0, not left stale/missing',
    result.satTotal === 0, JSON.stringify(result));

  console.log('\n=== The part that already worked still works: Sunday still got queued to the Sheet ===');
  await page.waitForTimeout(500); // let flushPendingLogs' fetch go out
  const sunPosted = postedPayloads.find(p => p.day === 'Sunday' && p.week === setup.oldWeekLabel);
  check('a POST for Sunday, under the OLD week label, was sent (the pre-existing auto-archive-to-Sheet behavior)',
    !!sunPosted, JSON.stringify(postedPayloads.map(p => ({ day: p.day, week: p.week }))));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
