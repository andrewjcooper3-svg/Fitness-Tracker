/* Real bug report: "I dont see a monday workout" - right after gym days
   moved from Wednesday/Friday to Monday/Wednesday.

   Root cause: Monday was a fixed rest day for its entire history, so
   every device already has WORKOUT_TRACKER_STATE with
   days.mon = { exercises: [], ... } - serializeDay() maps zero
   .exercise-card elements to exactly that empty array, every single
   save. restoreDay's deletedEverything branch (added for a real earlier
   bug: "deleting a day's only exercise never pruned") cannot tell that
   apart from a genuine "the user deleted every exercise on this day" -
   both are an explicit exercises: []. Left alone, Monday's harmless,
   always-empty rest-day array gets read as a deliberate delete-
   everything and prunes the fresh 11-card gym template renderWeeklyPlan_
   just built right back down to zero cards - so the user opens the app
   and Monday looks empty, exactly as reported.

   Fixed the same way the three earlier schedule moves (Jul 27, Aug 24,
   Aug 31) were: a one-time migration that deletes (not empties) the
   stale exercises key for the days whose template shape changed, which
   puts them back in the "nothing to prune against" state and lets the
   fresh template render untouched. */
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
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

  console.log('=== Seeding exactly what every real device already has: Monday saved as an always-empty rest day ===');
  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const state = {
      week: getWeekLabel(),
      days: {
        mon: { exercises: [], checkItems: [], dayNotes: '' },
        tue: { exercises: [], checkItems: [], dayNotes: '' },
        wed: { exercises: [], checkItems: [], dayNotes: '' },
        thu: { exercises: [], checkItems: [], dayNotes: '' },
        // Friday still carries its OLD real gym data - the schedule
        // moved that content to Monday, so this is now stale too.
        fri: {
          exercises: [
            { id: 'ex0', name: 'Leg Press', sets: [{ weight: '265 lb', reps: '10', checked: true }] },
            { id: 'ex1', name: 'Dumbbell Romanian Deadlift', sets: [{ weight: '90 lb', reps: '10', checked: true }] }
          ],
          checkItems: [], dayNotes: ''
        },
        sat: { exercises: [], checkItems: [], dayNotes: '' },
        sun: { exercises: [], checkItems: [], dayNotes: '' }
      }
    };
    localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify(state));
    // Pretend this device already ran every migration through Aug 31 -
    // only the new Sep 14 one should still be pending.
    localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260727', '1');
    localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260824', '1');
    localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260831', '1');
    localStorage.removeItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260914');
  });

  console.log('\n=== Reloading - this is the exact moment the bug report describes ===');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const monCards = await page.evaluate(() =>
    [...document.querySelectorAll('#day-mon .exercise-card .exercise-name')].map(e => e.textContent));
  console.log('  Monday cards after reload:', monCards.length, '-', monCards.join(', '));
  check('Monday shows its real 11-card gym workout, not an empty day',
    monCards.length === 11 && monCards[0] === 'Leg Press' && monCards.includes('Dumbbell Romanian Deadlift'),
    monCards.join(', '));

  const friCards = await page.evaluate(() =>
    [...document.querySelectorAll('#day-fri .exercise-card')].length);
  check('Friday shows no cards (correctly a rest day now, old gym data not resurrected as customs)',
    friCards === 0, String(friCards));

  const migrated = await page.evaluate(() => localStorage.getItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260914'));
  check('the migration flag is now set (runs once)', migrated === '1', migrated);

  console.log('\n=== A second reload must not re-break anything (migration already applied, Monday now has real saved data) ===');
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const monCardsAgain = await page.evaluate(() =>
    [...document.querySelectorAll('#day-mon .exercise-card .exercise-name')].map(e => e.textContent));
  check('Monday still shows all 11 cards on a normal reload', monCardsAgain.length === 11, monCardsAgain.join(', '));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));
  await browser.close();

  // Second browser: the actual reported follow-up. The local migration
  // above heals localStorage, but fetchAndApplyRemoteDraft() pulls a
  // SEPARATE cloud copy straight past it - if that copy was synced
  // (from an earlier reload, before this fix shipped) with a savedAt
  // newer than this boot's local snapshot, it wins the race and
  // re-wipes Monday again, moments after the local fix just applied.
  // This is a brand-new context (no prior localStorage), isolating it
  // from everything above.
  console.log('\n=== The remote-draft path: a still-stale, newer cloud copy must not re-wipe Monday right after the local fix ===');
  {
    const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const page2 = await browser2.newPage({ viewport: { width: 390, height: 950 } });
    const errors2 = [];
    page2.on('pageerror', e => errors2.push(String(e)));

    const primer = await browser2.newContext();
    const primerPage = await primer.newPage();
    await primerPage.route('https://script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));
    await primerPage.goto(URL);
    await primerPage.waitForFunction(() => typeof getWeekLabel === 'function', null, { timeout: 15000 });
    const weekLabel = await primerPage.evaluate(() => getWeekLabel());
    await primer.close();

    await page2.route('https://script.google.com/**', (route) => {
      if (route.request().url().includes('action=loadDraft')) {
        route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            draft: {
              week: weekLabel,
              // Deliberately far in the future - guarantees it reads as
              // newer than whatever local savedAt this boot captures,
              // exactly the race window that let a stale cloud copy win.
              savedAt: new Date(Date.now() + 60000).toISOString(),
              days: {
                mon: { exercises: [], checkItems: [], dayNotes: '' } // the same stale, pre-fix shape
              }
            }
          })
        });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"success"}' });
      }
    });

    await page2.goto(URL);
    await page2.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    await page2.evaluate((wk) => {
      localStorage.setItem('WORKOUT_TRACKER_STATE', JSON.stringify({
        week: wk,
        days: { mon: { exercises: [], checkItems: [], dayNotes: '' } }
      }));
      localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260727', '1');
      localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260824', '1');
      localStorage.setItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260831', '1');
      localStorage.removeItem('WORKOUT_DAY_TEMPLATE_MIGRATED_20260914');
    }, weekLabel);

    await page2.reload();
    await page2.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
    // Long enough for both the local migration/restore AND the async
    // fetchAndApplyRemoteDraft() round trip to finish.
    await page2.waitForTimeout(2500);

    const monCardsAfterRemote = await page2.evaluate(() =>
      [...document.querySelectorAll('#day-mon .exercise-card .exercise-name')].map(e => e.textContent));
    check('Monday still shows all 11 cards after a stale-but-newer remote draft is fetched',
      monCardsAfterRemote.length === 11 && monCardsAfterRemote[0] === 'Leg Press', monCardsAfterRemote.join(', '));
    check('no page errors', errors2.length === 0, errors2.join(' | '));
    await browser2.close();
  }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
