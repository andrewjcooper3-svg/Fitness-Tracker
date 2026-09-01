// The Water widget used to be hard-wired to "today" everywhere - the ring,
// the +/- buttons, the Add form, even the time boxes (readTimeInput_ built
// its Date from `new Date()`, always today, no matter what time you typed).
// Miss a day and there was no way to go back and log it after the fact.
//
// This checks the "back a day" nav added to fix that: the ring/label/nav
// buttons track a viewed day (wtViewDay) instead of always today, adding
// water while viewing a past day lands on THAT day's ledger (and its
// timestamp carries that day's date, not today's), today's own total is
// untouched by it, and Undo - which can only ever remove a local draft,
// never a row already written to the Water Log sheet - hides itself once
// a day is marked synced rather than pretending to work.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../Workout_Tracker_AutoLog.html');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://script.google.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"error"}' }));

  await page.goto(URL);
  await page.waitForFunction(() => typeof showAppView === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => showAppView('overview'));
  await page.waitForTimeout(300);

  console.log('=== Defaults to today ===');
  let nav = await page.evaluate(() => ({
    label: document.getElementById('wtDayNavLabel').textContent,
    nextDisabled: document.getElementById('wtDayNextBtn').disabled,
    todayBtnHidden: document.getElementById('wtDayTodayBtn').style.display === 'none'
  }));
  check('label reads Today', nav.label === 'Today', nav.label);
  check('next-day is disabled (cannot go past today)', nav.nextDisabled);
  check('the Today jump button is hidden while already on today', nav.todayBtnHidden);

  console.log('\n=== Going back a day ===');
  await page.evaluate(() => wtDayPrev());
  await page.waitForTimeout(150);
  nav = await page.evaluate(() => ({
    label: document.getElementById('wtDayNavLabel').textContent,
    nextDisabled: document.getElementById('wtDayNextBtn').disabled,
    todayBtnHidden: document.getElementById('wtDayTodayBtn').style.display === 'none'
  }));
  check('label now names the previous day, not "Today"', nav.label !== 'Today' && nav.label.length > 0, nav.label);
  check('next-day is enabled again', !nav.nextDisabled);
  check('the Today jump button reappears', !nav.todayBtnHidden);

  console.log('\n=== Adding water while viewing yesterday lands on yesterday, not today ===');
  const before = await page.evaluate(() => {
    const ledger = JSON.parse(localStorage.getItem('WORKOUT_WATER_LEDGER') || '{}');
    const today = dateKey(new Date());
    const yesterday = dateKey(new Date(Date.now() - 86400000));
    return { todayOz: ledger[today] || 0, yesterdayOz: ledger[yesterday] || 0, todayKey: today, yesterdayKey: yesterday };
  });
  await page.evaluate(() => document.getElementById('wtBtnWater').click());
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const ledger = JSON.parse(localStorage.getItem('WORKOUT_WATER_LEDGER') || '{}');
    const today = dateKey(new Date());
    const yesterday = dateKey(new Date(Date.now() - 86400000));
    return { todayOz: ledger[today] || 0, yesterdayOz: ledger[yesterday] || 0 };
  });
  check('yesterday\'s ledger total went up', after.yesterdayOz > before.yesterdayOz, `${before.yesterdayOz} -> ${after.yesterdayOz}`);
  check('today\'s ledger total is untouched', after.todayOz === before.todayOz, `${before.todayOz} -> ${after.todayOz}`);

  const entryDate = await page.evaluate((yKey) => {
    const store = JSON.parse(localStorage.getItem('WORKOUT_WATER_ENTRIES') || '{}');
    const entries = (store.days || {})[yKey] || [];
    const last = entries[entries.length - 1];
    return last ? last.loggedAt.slice(0, 10) : null;
  }, before.yesterdayKey);
  check('the new entry\'s own timestamp carries yesterday\'s date, not today\'s',
    entryDate === before.yesterdayKey, `entry date ${entryDate}, expected ${before.yesterdayKey}`);

  const ringAfterAdd = await page.evaluate(() => document.getElementById('wtRingNum').textContent);
  check('the ring on screen reflects yesterday\'s new total', Number(ringAfterAdd) === Math.round(after.yesterdayOz), ringAfterAdd);

  console.log('\n=== Undo is available for that not-yet-synced backdated entry ===');
  let undoVisible = await page.evaluate(() => document.getElementById('wtUndoBtn').style.display !== 'none');
  check('Undo shows up for a pending (unsynced) day', undoVisible);
  await page.evaluate(() => document.getElementById('wtUndoBtn').click());
  await page.waitForTimeout(150);
  const afterUndo = await page.evaluate((yKey) => {
    const ledger = JSON.parse(localStorage.getItem('WORKOUT_WATER_LEDGER') || '{}');
    return ledger[yKey] || 0;
  }, before.yesterdayKey);
  check('undo brought yesterday\'s total back down', Math.abs(afterUndo - before.yesterdayOz) < 0.01, `${afterUndo} vs original ${before.yesterdayOz}`);

  console.log('\n=== Undo hides itself once the day is marked synced (no delete endpoint exists for it) ===');
  await page.evaluate((yKey) => {
    localStorage.setItem('WORKOUT_WATER_SYNCED_DAYS', JSON.stringify([yKey]));
    renderOverviewWaterWidget();
  }, before.yesterdayKey);
  await page.evaluate(() => document.getElementById('wtBtnWater').click());
  await page.waitForTimeout(150);
  undoVisible = await page.evaluate(() => document.getElementById('wtUndoBtn').style.display !== 'none');
  check('Undo is hidden once the day is synced, even though there is a fresh entry', !undoVisible);

  console.log('\n=== Jumping back to today ===');
  await page.evaluate(() => wtDayJumpToday());
  await page.waitForTimeout(150);
  nav = await page.evaluate(() => document.getElementById('wtDayNavLabel').textContent);
  check('back to Today', nav === 'Today', nav);
  const todayRing = await page.evaluate((tKey) => {
    const ledger = JSON.parse(localStorage.getItem('WORKOUT_WATER_LEDGER') || '{}');
    return { ring: document.getElementById('wtRingNum').textContent, ledger: Math.round(ledger[tKey] || 0) };
  }, before.todayKey);
  check('today\'s own total is exactly what it started as (never touched by any of the above)',
    Number(todayRing.ring) === Math.round(before.todayOz) && todayRing.ledger === Math.round(before.todayOz),
    JSON.stringify(todayRing));

  check('no page errors across the whole flow', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
