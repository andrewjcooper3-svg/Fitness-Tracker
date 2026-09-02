/* Ported from a standalone artifact mockup into the real Trainer tab:
   weight and reps are now bold, label-free numbers (the "WEIGHT"/"REPS"
   captions are gone), what a set's second number even means (reps vs a
   timed hold) is a single badge on the exercise header instead of a
   label repeated on every row, and a set's note field is hidden behind
   a "Notes" button that reveals a full-width field below the row
   instead of always sitting open.

   What matters here is that none of this is just a skin: the actual
   .set-input elements parseExerciseCard/serializeDay/restoreDay read
   and write by position are exactly the same three per row (weight,
   reps, notes) as before - only how they're presented changed. */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('tracker'); showDay('tue'); });
  await page.waitForTimeout(300);
  // Expand the first exercise - clicking any of its buttons requires it to
  // actually be visible, not just present (.exercise-sets is display:none
  // until toggled).
  await page.click('#day-tue .exercise-card .exercise-header');
  await page.waitForTimeout(150);

  console.log('=== No more per-row "WEIGHT"/"REPS" labels ===');
  const labelCount = await page.evaluate(() => document.querySelectorAll('#day-tue .set-input-label').length);
  check('the old label divs are gone entirely', labelCount === 0, String(labelCount));

  console.log('\n=== Weight and reps are big, bold, unlabeled numbers ===');
  const legPress = await page.evaluate(() => {
    const card = document.querySelector('#day-tue .exercise-card');
    const row = card.querySelector('.set-row');
    const inputs = row.querySelectorAll('.set-input');
    return {
      count: inputs.length,
      weightIsBig: inputs[0].classList.contains('big-num'),
      repsIsBig: inputs[1].classList.contains('big-num'),
      weightPlaceholder: inputs[0].placeholder,
      repsPlaceholder: inputs[1].placeholder
    };
  });
  check('three .set-input fields per row, same as before (weight, reps, notes)', legPress.count === 3, String(legPress.count));
  check('weight is styled big-num', legPress.weightIsBig);
  check('reps is styled big-num', legPress.repsIsBig);
  check('weight keeps its real placeholder', legPress.weightPlaceholder === '255 lb', legPress.weightPlaceholder);
  check('reps keeps its real placeholder', legPress.repsPlaceholder === '10', legPress.repsPlaceholder);

  console.log('\n=== Reps-vs-Time moved to one badge per exercise ===');
  const badges = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#day-tue .exercise-card')];
    return cards.map(c => ({
      name: c.querySelector('.exercise-name').textContent.trim(),
      badge: (c.querySelector('.unit-badge') || {}).textContent
    }));
  });
  const legPressBadge = badges.find(b => b.name === 'Leg Press');
  const plankBadge = badges.find(b => b.name === 'Plank');
  check('Leg Press (a reps exercise) shows a Reps badge', legPressBadge && legPressBadge.badge === 'Reps', JSON.stringify(legPressBadge));
  check('Plank (a timed exercise) shows a Time badge', plankBadge && plankBadge.badge === 'Time', JSON.stringify(plankBadge));

  console.log('\n=== Notes is a button that reveals a field, not an always-open box ===');
  const beforeOpen = await page.evaluate(() => {
    const card = document.querySelector('#day-tue .exercise-card');
    const panel = card.querySelector('.notes-panel');
    return { display: panel.style.display, btnText: card.querySelector('.notes-btn').textContent.trim() };
  });
  check('the note field starts hidden', beforeOpen.display === 'none', beforeOpen.display);
  check('the button just says "Notes" with nothing written yet', beforeOpen.btnText === 'Notes', beforeOpen.btnText);

  await page.click('#day-tue .exercise-card .notes-btn');
  await page.waitForTimeout(100);
  const afterOpen = await page.evaluate(() => document.querySelector('#day-tue .exercise-card .notes-panel').style.display);
  check('clicking Notes reveals the field', afterOpen !== 'none', afterOpen);

  await page.fill('#day-tue .exercise-card .notes-input', 'Felt strong today');
  await page.waitForTimeout(100);
  const afterType = await page.evaluate(() => {
    const card = document.querySelector('#day-tue .exercise-card');
    const btn = card.querySelector('.notes-btn');
    return { text: btn.textContent.trim(), hasNote: btn.classList.contains('has-note') };
  });
  check('the button shows a dot once something is written', /●/.test(afterType.text) && afterType.hasNote, JSON.stringify(afterType));

  await page.click('#day-tue .exercise-card .notes-panel-done');
  await page.waitForTimeout(100);
  const afterDone = await page.evaluate(() => document.querySelector('#day-tue .exercise-card .notes-panel').style.display);
  check('Done collapses the field again', afterDone === 'none', afterDone);

  console.log('\n=== parseExerciseCard still captures it correctly (nothing about save/summary changed) ===');
  const parsed = await page.evaluate(() => {
    const card = document.querySelector('#day-tue .exercise-card');
    return parseExerciseCard(card).sets[0];
  });
  check('the note text made it into the parsed set', parsed.notes === 'Felt strong today', JSON.stringify(parsed));
  check('weight/reps are unaffected', parsed.actualWeight === 255 && parsed.actualReps === '10', JSON.stringify(parsed));

  console.log('\n=== A saved note survives a reload, and the button reflects it on restore ===');
  await page.evaluate(() => saveState());
  await page.reload();
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showAppView('tracker'); showDay('tue'); });
  await page.waitForTimeout(300);
  await page.click('#day-tue .exercise-card .exercise-header');
  await page.waitForTimeout(150);
  const restored = await page.evaluate(() => {
    const card = document.querySelector('#day-tue .exercise-card');
    const btn = card.querySelector('.notes-btn');
    return { value: card.querySelector('.notes-input').value, hasNote: btn.classList.contains('has-note'), text: btn.textContent.trim() };
  });
  check('the note text itself survived the reload', restored.value === 'Felt strong today', JSON.stringify(restored));
  check('the button already shows the dot on restore, without having to open it first', restored.hasNote && /●/.test(restored.text), JSON.stringify(restored));

  console.log('\n=== + Add Set builds a row in the same new shape ===');
  await page.click('#day-tue .exercise-card .add-set-btn');
  await page.waitForTimeout(150);
  const newRow = await page.evaluate(() => {
    const card = document.querySelector('#day-tue .exercise-card');
    const rows = card.querySelectorAll('.set-row');
    const last = rows[rows.length - 1];
    return {
      count: rows.length,
      hasLabels: !!last.querySelector('.set-input-label'),
      hasNotesBtn: !!last.querySelector('.notes-btn'),
      weightIsBig: last.querySelectorAll('.set-input')[0].classList.contains('big-num')
    };
  });
  check('a 4th set was added', newRow.count === 4, String(newRow.count));
  check('the new row has no label divs either', !newRow.hasLabels);
  check('the new row has a Notes button too', newRow.hasNotesBtn);
  check('the new row\'s weight is big-num styled too', newRow.weightIsBig);

  console.log('\n=== A custom exercise gets the same treatment ===');
  await page.click('#day-tue .add-exercise-btn');
  await page.waitForTimeout(150);
  const custom = await page.evaluate(() => {
    const cards = document.querySelectorAll('#day-tue .exercise-card');
    const card = cards[cards.length - 1];
    return {
      badge: (card.querySelector('.unit-badge') || {}).textContent,
      hasNotesBtn: !!card.querySelector('.notes-btn'),
      hasLabels: !!card.querySelector('.set-input-label')
    };
  });
  check('a fresh custom exercise defaults to a Reps badge', custom.badge === 'Reps', custom.badge);
  check('and has the same Notes button, no labels', custom.hasNotesBtn && !custom.hasLabels, JSON.stringify(custom));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
