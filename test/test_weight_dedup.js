/* A Shortcut reading "most recent weight sample" from Health resends that
   same cached number on a day nobody actually stepped on the scale - it
   has no way to tell "still true" from "no new data today," so a normal
   upsert-by-date would happily record a fake extra "measurement" every
   day you skip weighing in. logWeightEntry_() now refuses to write (and
   deletes if already written) an entry that exactly matches the closest
   PRIOR entry on record - genuine coincidences of two identical readings
   in a row are rare enough, and this failure mode common enough, that an
   exact match is treated as the stale echo rather than a real one.

   Runs the REAL logWeightEntry_() / getWeightLog_() from code.gs against
   a stubbed SpreadsheetApp, same harness as test_backfill.js. */
const fs = require('fs');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  getLastRow() { return this.rows.length; }
  appendRow(r) { this.rows.push(r.slice()); }
  setFrozenRows() {}
  getRange(r, c, nr, nc) {
    const self = this;
    nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = self.rows[r - 1 + i] || [];
          out.push(row.slice(c - 1, c - 1 + nc));
        }
        return out;
      },
      setValues(vals) {
        vals.forEach((row, i) => {
          while (self.rows.length < r - 1 + i) self.rows.push([]);
          self.rows[r - 1 + i] = row.slice();
        });
      },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }
    };
  }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
  getParent() { return ss; }
}

class SS {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSpreadsheetTimeZone() { return 'America/New_York'; }
}

const ss = new SS([]);
global.SpreadsheetApp = { openById: () => ss, create: () => ss };
global.PropertiesService = { getScriptProperties: () => ({ props: { SHEET_ID: 'fake' },
  getProperty(k) { return this.props[k]; }, setProperty(k, v) { this.props[k] = v; } }) };
global.Utilities = { formatDate: (d, tz, fmt) => {
  const p = n => String(n).padStart(2, '0');
  return fmt === 'yyyy-MM-dd' ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` : d.toISOString();
} };

const src = fs.readFileSync('/home/user/Fitness-Tracker/code.gs', 'utf8');
eval(src.replace(/^function doGet[\s\S]*$/m, ''));
// logWeightEntry_ / getWeightLog_ / getOrCreateWeightSheet_ now callable
// directly - sloppy-mode direct eval leaks function declarations into
// this scope (same trick test_backfill.js relies on).

const weights = () => getWeightLog_().map(e => ({ date: e.date, weight: e.weight }));

console.log('=== A fresh, different weight logs normally ===');
logWeightEntry_('2026-08-20', 180.0, null, 'shortcut');
check('day 1 is recorded', JSON.stringify(weights()) === JSON.stringify([{ date: '2026-08-20', weight: 180 }]), JSON.stringify(weights()));

console.log('\n=== An exact repeat of the prior day is dropped, not recorded ===');
logWeightEntry_('2026-08-21', 180.0, null, 'shortcut');
check('day 2 (same 180.0) never gets written', weights().length === 1, JSON.stringify(weights()));

console.log('\n=== A genuinely different reading still logs ===');
logWeightEntry_('2026-08-21', 179.4, null, 'shortcut');
check('day 2 now recorded at the real value', JSON.stringify(weights()) === JSON.stringify([
  { date: '2026-08-20', weight: 180 }, { date: '2026-08-21', weight: 179.4 }
]), JSON.stringify(weights()));

console.log('\n=== Repeating THAT value the next day is dropped too (chains, not just vs. day 1) ===');
logWeightEntry_('2026-08-22', 179.4, null, 'shortcut');
check('day 3 (same as day 2) is not written', weights().length === 2, JSON.stringify(weights()));

console.log('\n=== A gap in logging does not defeat the check ===');
logWeightEntry_('2026-08-27', 179.4, null, 'shortcut'); // 5 days later, still a repeat of the last real entry
check('a repeat after a multi-day gap is still caught (compares to the last entry ON RECORD, not strictly "yesterday")',
  weights().length === 2, JSON.stringify(weights()));
logWeightEntry_('2026-08-27', 176.8, null, 'shortcut');
check('a real change after the gap logs fine', weights().length === 3, JSON.stringify(weights()));

console.log('\n=== An already-written entry that turns into a duplicate gets REMOVED ===');
// Same day logged twice in one day (a manual correction, or a second Shortcut
// run) - first call writes a real value, second call repeats the prior day
// and should delete the row it just wrote, not leave a stale duplicate.
logWeightEntry_('2026-08-28', 175.0, null, 'shortcut'); // real value, written
check('the corrective write landed first', weights().some(w => w.date === '2026-08-28'));
logWeightEntry_('2026-08-28', 176.8, null, 'shortcut'); // now exactly matches 8/27 - should be deleted
check('a same-day rewrite that becomes a duplicate is deleted, not left in the sheet',
  !weights().some(w => w.date === '2026-08-28'), JSON.stringify(weights()));

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
