/* Real bug report: "my inputs on Wednesday workouts are getting wiped on
   refresh" - happening with NO special action needed (no reordering, just
   type something and refresh), which pointed at something more general
   than the earlier reorder-guard fix (test_exercise_reorder_persists.js).

   Root cause: saveState() writes to localStorage immediately, but the
   matching push to the cloud (syncDraftToCloud -> sendDraftNow) is
   debounced 1.5s and still needs a network round trip. fetchAndApply-
   RemoteDraft() runs on every page load and used to apply whatever the
   cloud's last-synced draft was UNCONDITIONALLY via restoreDay, with no
   check for whether that cloud copy was actually older than what this
   device already has. Refresh inside that ~1.5s+round-trip window - an
   extremely normal thing to do mid-workout, or for the tab to do on its
   own (mobile Safari reloading a backgrounded tab, the app's own
   week-rollover reload) - and the just-typed, correctly-locally-saved
   value would get overwritten by the stale cloud copy. Not a one-time
   fluke either: it would happen on every refresh that raced the debounce
   window, which for a phone typing through a workout is often.

   Fixed by having saveState() stamp a savedAt timestamp on every save,
   and fetchAndApplyRemoteDraft() skip applying the fetched draft unless
   the cloud's own savedAt (already returned by the backend, previously
   just never used) is strictly newer than a snapshot of the local
   state's savedAt taken BEFORE restoreState() runs (restoreState()
   itself calls saveState() to self-initialize when there is no saved
   state yet, which would otherwise make a device with no prior local
   data look "newer" than any real remote draft and wrongly skip it).

   A second, independent bug turned up chasing the same report and
   explains why it was specifically WEDNESDAY: fetchAndApplyRemoteDraft
   used to run the one-time stripStaleWednesday20260824_ / stripStale-
   GymScheduleMove20260831_ / stripStaleDayTemplateExercises_ migration
   helpers against the freshly-fetched REMOTE draft, gated on flags that
   only mean "has THIS DEVICE seen this migration before" - nothing to do
   with whether the remote draft itself is actually stale. Any device
   with no local migration history yet (private browsing, a new browser
   profile, a phone that clears site data) would unconditionally strip
   Wednesday's exercises out of an otherwise perfectly current remote
   draft before restoreDay ever got to see them - wiping it on literally
   every load for that device. Fixed by removing those calls entirely:
   restoreDay's own plan-changed guard (comparing the draft's actual
   exercise names against the current plan) already protects against a
   genuinely stale remote draft, based on real content rather than this
   device's own migration bookkeeping.

   What is checked here:
     - a stale remote draft (older savedAt) does NOT overwrite a fresher
       local edit - the exact race from the bug report,
     - a genuinely newer remote draft (a real edit from another device)
       still correctly applies - the legitimate cross-device sync case
       this function exists for is not broken by the fix,
     - a brand-new device with no local state at all still pulls the
       remote draft normally - not stripped of Wednesday's exercises by
       its own never-run-before migration flags,
     - a genuinely stale remote draft (real old exercise names) is still
       safely rejected without the removed stripping calls,
     - an existing local state saved before this fix shipped (no savedAt
       field yet) still safely accepts the remote draft rather than
       erroring or permanently refusing to sync. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const WED_NAMES = ['Leg Press', 'Leg Extension', 'Leg Curl', 'Glute Kickback', 'Lat Pulldown',
  'Single Arm DB Row (Left Emphasis)', 'Lateral Raise', 'Reverse Pec Deck Fly',
  'Face Pull', 'Pull-ups', 'Cable Bicep Curl', 'Reverse Crunch', 'Plank', 'Pushups'];

function mockExercises(firstWeight) {
  return WED_NAMES.map((name, i) => ({
    id: 'ex' + i, custom: false, name, meta: '',
    sets: [{ weight: i === 0 ? firstWeight : '', reps: '', notes: '', checked: false, checkedAt: '', quality: '' }]
  }));
}

async function newPageWithMockedDraft(browser, getDraftResponse) {
  // A fresh, isolated context per scenario - browser.newPage() alone would
  // share one context (and so one localStorage) across every call, which
  // would make the "brand-new device" and "pre-fix local state" cases
  // silently inherit leftover state from whichever scenario ran first.
  const context = await browser.newContext({ viewport: { width: 390, height: 950 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', async (route) => {
    const req = route.request();
    if (req.url().includes('action=loadDraft')) {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getDraftResponse()) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
    }
  });
  return { page, context, errors };
}

async function firstWeightOnWed(page) {
  await page.evaluate(() => { showAppView('tracker'); showDay('wed'); });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const card = document.querySelector('#day-wed .exercise-card');
    card.querySelector('.exercise-header').click();
    return card.querySelector('.set-row').querySelectorAll('.set-input')[0].value;
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // Read the real week label ONCE, up front, from a disposable page - the
  // app's own fetchAndApplyRemoteDraft() fires very early during boot
  // (before this script's first post-goto evaluate would run), so every
  // scenario's mocked loadDraft route needs the correct label in place
  // from its very first request, not assigned after the fact.
  const primer = await browser.newContext();
  const primerPage = await primer.newPage();
  await primerPage.route('https://script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
  await primerPage.goto(URL);
  await primerPage.waitForFunction(() => typeof getWeekLabel === 'function', null, { timeout: 15000 });
  const weekLabel = await primerPage.evaluate(() => getWeekLabel());
  await primer.close();

  console.log('=== A stale remote draft does not overwrite a fresher, not-yet-synced local edit ===');
  {
    const staleSavedAt = { current: new Date(Date.now() - 5 * 60 * 1000).toISOString() }; // 5 minutes stale
    const { page, context, errors } = await newPageWithMockedDraft(browser, () => ({
      status: 'success',
      draft: { week: weekLabel, savedAt: staleSavedAt.current, days: { wed: { exercises: mockExercises('200'), checkItems: [], dayNotes: '' } } }
    }));
    await page.goto(URL);
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(500);

    await firstWeightOnWed(page);
    await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const inputs = document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input');
      inputs[0].value = '321';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(100); // shorter than the 1500ms cloud-sync debounce - the race window

    await page.reload();
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(2500); // let both the local restore and the async remote fetch finish
    const value = await firstWeightOnWed(page);
    check('the fresher local value (321) survives the stale remote draft (200)', value === '321', value);
    check('no page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  console.log('\n=== A genuinely newer remote draft (real cross-device edit) still applies ===');
  {
    const remoteSavedAt = { current: null };
    const { page, context, errors } = await newPageWithMockedDraft(browser, () => ({
      status: 'success',
      draft: { week: weekLabel, savedAt: remoteSavedAt.current, days: { wed: { exercises: mockExercises('450'), checkItems: [], dayNotes: '' } } }
    }));
    await page.goto(URL);
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(500);

    await firstWeightOnWed(page);
    await page.evaluate(() => document.querySelector('#day-wed .exercise-card .exercise-header').click());
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const inputs = document.querySelector('#day-wed .exercise-card .set-row').querySelectorAll('.set-input');
      inputs[0].value = '100';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const localSavedAt = await page.evaluate(() => JSON.parse(localStorage.getItem('WORKOUT_TRACKER_STATE')).savedAt);
    remoteSavedAt.current = new Date(new Date(localSavedAt).getTime() + 60000).toISOString(); // a full minute newer

    await page.reload();
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const value = await firstWeightOnWed(page);
    check('the genuinely newer remote edit (450) from another device is applied, not stuck on stale local (100)', value === '450', value);
    check('no page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  console.log('\n=== A brand-new device with no local state at all still pulls the remote draft ===');
  {
    const { page, context, errors } = await newPageWithMockedDraft(browser, () => ({
      status: 'success',
      draft: { week: weekLabel, savedAt: new Date().toISOString(), days: { wed: { exercises: mockExercises('555'), checkItems: [], dayNotes: '' } } }
    }));
    await page.goto(URL);
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const value = await firstWeightOnWed(page);
    check('the remote draft applies normally with no local state to compare against', value === '555', value);
    check('no page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  console.log('\n=== A genuinely stale remote draft (old, pre-rebalance exercise names) is still handled safely ===');
  {
    // Old Wednesday, before this session's pulling-volume rebalance -
    // Machine Chest Press instead of Lat Pulldown/Face Pull/Pull-ups.
    // This is exactly the shape the removed stripStaleWednesday20260824_/
    // stripStaleGymScheduleMove20260831_ calls used to specifically guard
    // against - the check here is that removing those calls from
    // fetchAndApplyRemoteDraft did NOT remove the actual protection,
    // since restoreDay's own plan-changed guard (comparing exercise
    // names against the current plan) catches this generically.
    const staleExercises = ['Leg Press', 'Leg Extension', 'Leg Curl', 'Glute Kickback', 'Machine Chest Press',
      'Single Arm DB Row (Left Emphasis)', 'Lateral Raise', 'Reverse Pec Deck Fly', 'Tricep Pushdown',
      'Cable Bicep Curl', 'Reverse Crunch', 'Plank', 'Pushups'
    ].map((name, i) => ({ id: 'ex' + i, custom: false, name, meta: '', sets: [{ weight: '999', reps: '', notes: '', checked: false, checkedAt: '', quality: '' }] }));
    const { page, context, errors } = await newPageWithMockedDraft(browser, () => ({
      status: 'success',
      draft: { week: weekLabel, savedAt: new Date().toISOString(), days: { wed: { exercises: staleExercises, checkItems: [], dayNotes: '' } } }
    }));
    await page.goto(URL);
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const names = await page.evaluate(() => [...document.querySelectorAll('#day-wed .exercise-card .exercise-name')].map(e => e.textContent));
    check('the stale remote exercises are NOT applied (no Machine Chest Press bleeding through)', !names.includes('Machine Chest Press'), JSON.stringify(names));
    check('the current, correct 14-exercise Wednesday template renders instead', names.length === 14 && names[0] === 'Leg Press', JSON.stringify(names));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  console.log('\n=== Local state saved before this fix shipped (no savedAt field) still syncs safely ===');
  {
    const { page, context, errors } = await newPageWithMockedDraft(browser, () => ({
      status: 'success',
      draft: { week: weekLabel, savedAt: new Date().toISOString(), days: { wed: { exercises: mockExercises('555'), checkItems: [], dayNotes: '' } } }
    }));
    await page.goto(URL);
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.evaluate((wk) => {
      const exercises = ['Leg Press', 'Leg Extension', 'Leg Curl', 'Glute Kickback', 'Lat Pulldown',
        'Single Arm DB Row (Left Emphasis)', 'Lateral Raise', 'Reverse Pec Deck Fly',
        'Face Pull', 'Pull-ups', 'Cable Bicep Curl', 'Reverse Crunch', 'Plank', 'Pushups'
      ].map((name, i) => ({ id: 'ex' + i, name, sets: [{ weight: i === 0 ? '111' : '', reps: '' }] }));
      // Deliberately no savedAt - simulating a state blob written by a pre-fix version of the app.
      localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify({ week: wk, days: { wed: { exercises, checklist: {} } } }));
    }, weekLabel);

    await page.reload();
    await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    const value = await firstWeightOnWed(page);
    check('the remote draft still applies safely with no savedAt to compare against locally', value === '555', value);
    check('no page errors', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
