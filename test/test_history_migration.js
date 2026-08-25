/* The failure this exists for: adding three columns to the rollup sheet
   deleted it, the rebuild that was supposed to refill it did not finish,
   and roughly thirty logged days became four.

   Two separate bugs, both checked here:
     1. getOrCreateHistorySheet_ deleted the sheet on any header mismatch.
     2. the rebuild made a Sheets call per existing row inside a nested
        loop, so on a real history it hit the execution limit part way -
        and the auto-backfill only fires on an EMPTY sheet, so it could
        never resume.
   The call counter below is the guard for the second one: it fails if the
   work per row grows with the size of the sheet. */
const fs = require('fs');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

let calls = 0;
const count = () => { calls++; };

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  getSheetName() { return this.name; }
  setName(n) { this.name = n; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.length ? Math.max(...this.rows.map(r => r.length)) : 0; }
  getMaxRows() { return Math.max(this.rows.length, 1000); }
  appendRow(r) { count(); this.rows.push(r.slice()); }
  setFrozenRows() {} setColumnWidth() {}
  deleteRow(i) { count(); this.rows.splice(i - 1, 1); }
  getRange(r, c, nr = 1, nc = 1) {
    const self = this;
    return {
      getValues() {
        count();
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = self.rows[r - 1 + i] || [];
          const slice = [];
          for (let j = 0; j < nc; j++) slice.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(slice);
        }
        return out;
      },
      getValue() { count(); return (self.rows[r - 1] || [])[c - 1]; },
      setValues(vals) {
        count();
        vals.forEach((row, i) => {
          const target = r - 1 + i;
          while (self.rows.length <= target) self.rows.push([]);
          row.forEach((v, j) => { self.rows[target][c - 1 + j] = v; });
        });
      },
      setValue(v) { count(); (self.rows[r - 1] = self.rows[r - 1] || [])[c - 1] = v; },
      clearContent() {
        count();
        for (let i = 0; i < nr; i++) if (self.rows[r - 1 + i]) self.rows[r - 1 + i] = [];
        self.rows = self.rows.filter(x => x && x.length);
      },
      setFontWeight() { return this; }, setBackground() { return this; },
      setFontColor() { return this; }, setBorder() { return this; },
      setNumberFormat() { return this; }, setHorizontalAlignment() { return this; }
    };
  }
}

class SS {
  constructor(sheets) { this.sheets = sheets; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { count(); const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { count(); this.sheets = this.sheets.filter(x => x !== s); }
  getSpreadsheetTimeZone() { count(); return 'America/New_York'; }
  getId() { return 'fake'; }
}

const WEEK_HEADERS = ['Timestamp', 'Day', 'Exercise', 'Set', 'Target Weight', 'Actual Weight',
                      'Target Reps', 'Actual Reps', 'Completed', 'Notes', 'Quality'];

// Fifteen weeks, two lifting days each - roughly the shape of a real log.
function weekTabs(n) {
  const out = [];
  const start = new Date('2026-05-04T00:00:00');
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  for (let w = 0; w < n; w++) {
    const mon = new Date(start); mon.setDate(start.getDate() + w * 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const rows = [WEEK_HEADERS.slice()];
    ['Monday', 'Wednesday'].forEach(day => {
      [['Leg Press', 225 + w, 10], ['Lat Pulldown', 100 + w, 10], ['Pushups', 'BW', 55]].forEach(([ex, wt, reps]) => {
        for (let sn = 1; sn <= 3; sn++) {
          rows.push(['2026-01-01', day, ex, sn, wt, wt, reps, reps, 'Yes', '', 'Green']);
        }
      });
    });
    out.push(new Sheet(`Week of ${fmt(mon)} - ${fmt(sun)}, ${sun.getFullYear()}`, rows));
  }
  return out;
}

function load(sheets) {
  const ss = new SS(sheets);
  global.SpreadsheetApp = { openById: () => ss, create: () => ss, BorderStyle: { SOLID_MEDIUM: 1 } };
  global.PropertiesService = { getScriptProperties: () => ({ props: { SHEET_ID: 'fake' },
    getProperty(k) { return this.props[k]; }, setProperty(k, v) { this.props[k] = v; } }) };
  global.Utilities = { formatDate: (d, tz, f) => {
    const p = n => String(n).padStart(2, '0');
    return f === 'yyyy-MM-dd' ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
                              : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 0000`;
  } };
  global.Logger = { log: () => {} };
  const src = fs.readFileSync(__dirname + '/../code.gs', 'utf8');
  const api = eval(src.replace(/^function doGet[\s\S]*$/m, '')
    + '\n;({ getOrCreateHistorySheet_, rebuildHistoryFromWeekTabs_, getWorkoutHistory_, HISTORY_HEADERS })');
  return { ss, ...api };
}

console.log('=== A sheet on the old header keeps its rows ===');
{
  // Exactly the state before the redeploy: 13 columns, rows in it.
  const OLD = ['Date', 'Day', 'Exercise', 'Sets', 'Sets Done', 'Top Weight', 'Volume',
               'Target Reps', 'Total Reps', 'Green', 'Yellow', 'Red', 'Week'];
  const old = [OLD.slice()];
  for (let i = 0; i < 30; i++) {
    old.push([`2026-0${1 + (i % 9)}-0${1 + (i % 9)}`, 'Monday', 'Leg Press', 3, 3, 200 + i,
              6000, 10, 30, 3, 0, 0, 'Week of X']);
  }
  const hist = new Sheet('Workout History', old);
  const { ss, getOrCreateHistorySheet_, HISTORY_HEADERS } = load([hist, ...weekTabs(2)]);

  const sheet = getOrCreateHistorySheet_();
  check('the sheet is still there', !!ss.getSheetByName('Workout History'));
  check('it was not deleted and recreated', sheet === hist);
  check('the header was widened in place',
    sheet.rows[0].slice(0, HISTORY_HEADERS.length).join('|') === HISTORY_HEADERS.join('|'),
    sheet.rows[0].join('|'));
  check('all 30 rows survived', sheet.rows.length === 31, String(sheet.rows.length - 1));
  check('and their values are untouched', sheet.rows[1][5] === 200, String(sheet.rows[1][5]));
  check('nothing was parked as an old copy',
    !ss.getSheets().some(s => /old/.test(s.name)), ss.getSheets().map(s => s.name).join(', '));
}

console.log('\n=== A genuinely different header is parked, not destroyed ===');
{
  const weird = new Sheet('Workout History', [['Something', 'Else', 'Entirely'], ['a', 'b', 'c']]);
  const { ss, getOrCreateHistorySheet_ } = load([weird, ...weekTabs(1)]);
  getOrCreateHistorySheet_();
  const parked = ss.getSheets().find(s => /^Workout History \(old /.test(s.name));
  check('the unrecognised sheet was renamed, not deleted', !!parked, ss.getSheets().map(s => s.name).join(', '));
  check('its rows are intact', parked && parked.rows.length === 2, parked && String(parked.rows.length));
  check('a fresh sheet was made alongside', !!ss.getSheetByName('Workout History'));
}

console.log('\n=== The rebuild recovers every day, and finishes ===');
{
  const WEEKS = 15;
  const { rebuildHistoryFromWeekTabs_, getWorkoutHistory_ } = load([...weekTabs(WEEKS)]);
  calls = 0;
  const days = rebuildHistoryFromWeekTabs_(false);
  const after = calls;
  const hx = getWorkoutHistory_();
  console.log(`  ${WEEKS} weeks -> ${days} days, ${hx.length} rows, ${after} sheet calls`);

  check('two days per week, all recovered', days === WEEKS * 2, String(days));
  check('three exercises per day', hx.length === WEEKS * 2 * 3, String(hx.length));
  check('dates are real, not "Monday of some week"',
    hx.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)), hx[0] && hx[0].date);
  check('the new columns are populated', hx.some(r => r.est1RM > 0), String(hx[0] && hx[0].est1RM));

  /* The guard on the bug that actually broke it. The old code did a
     getValues + getSpreadsheetTimeZone per existing row per day, so calls
     grew with rows x days. A batched rebuild is a couple of calls per week
     tab plus a handful of writes. */
  check('the work does not blow up with history size', after < WEEKS * 8,
    `${after} calls for ${WEEKS} weeks`);

  // Re-running must be a no-op, not a doubling.
  const before = hx.length;
  calls = 0;
  rebuildHistoryFromWeekTabs_(false);
  const again = getWorkoutHistory_();
  check('re-running does not duplicate', again.length === before, `${before} -> ${again.length}`);
}

console.log('\n=== Rows no week tab covers are kept ===');
{
  // A day whose week tab has been renamed away must not vanish on rebuild.
  const { ss, getOrCreateHistorySheet_, rebuildHistoryFromWeekTabs_, getWorkoutHistory_, HISTORY_HEADERS } =
    load([...weekTabs(2)]);
  const hist = getOrCreateHistorySheet_();
  hist.rows.push(['2024-03-04', 'Friday', 'Ancient Lift', 3, 3, 999, 1000, 10, 30, 3, 0, 0,
                  'Week of Mar 4 - Mar 10, 2024', 10, 500, 1200]);
  rebuildHistoryFromWeekTabs_(false);
  const hx = getWorkoutHistory_();
  check('the orphaned row survived a rebuild',
    hx.some(r => r.exercise === 'Ancient Lift'), hx.map(r => r.exercise).join(','));
  check('and the week tabs still rebuilt alongside it',
    hx.filter(r => r.exercise === 'Leg Press').length === 4,
    String(hx.filter(r => r.exercise === 'Leg Press').length));

  // ...unless a full replace is explicitly asked for.
  rebuildHistoryFromWeekTabs_(true);
  const wiped = getWorkoutHistory_();
  check('replaceAll drops it, as asked', !wiped.some(r => r.exercise === 'Ancient Lift'));
}

console.log('\n=== A stray header row in the data is not a session ===');
{
  /* Found in the live sheet: a second copy of the header sitting at row 2,
     left over from widening the sheet in place. The keep-list only drops
     rows whose date+day a week tab covers, and a header's date covers
     nothing - so it survived every rebuild, and the app read it back as an
     exercise called "Exercise" with zero of everything. */
  const { ss, getOrCreateHistorySheet_, rebuildHistoryFromWeekTabs_, getWorkoutHistory_, HISTORY_HEADERS } =
    load([...weekTabs(2)]);
  const hist = getOrCreateHistorySheet_();
  hist.rows.splice(1, 0, HISTORY_HEADERS.slice());          // the duplicate
  hist.rows.push(['2024-03-04', 'Friday', 'Ancient Lift', 3, 3, 999, 1000, 10, 30, 3, 0, 0,
                  'Week of Mar 4 - Mar 10, 2024', 10, 500, 1200]);

  // Read must come good immediately, without waiting for a rebuild.
  const before = getWorkoutHistory_();
  check('the read skips it even before a rebuild',
    !before.some(r => r.exercise === 'Exercise'), before.map(r => r.exercise).join(','));
  check('and keeps the real orphan row', before.some(r => r.exercise === 'Ancient Lift'));

  rebuildHistoryFromWeekTabs_(false);
  const hx = getWorkoutHistory_();
  check('the rebuild drops it for good', !hx.some(r => r.exercise === 'Exercise'),
    hx.map(r => r.exercise).join(','));
  check('it is gone from the sheet, not just the read',
    !hist.rows.slice(1).some(r => r[2] === 'Exercise'),
    hist.rows.slice(1).filter(r => r[2] === 'Exercise').length + ' left');
  check('the orphan row still survived', hx.some(r => r.exercise === 'Ancient Lift'));
  check('and the week tabs rebuilt as usual',
    hx.filter(r => r.exercise === 'Leg Press').length === 4,
    String(hx.filter(r => r.exercise === 'Leg Press').length));
  check('the real header is still row 1',
    hist.rows[0].join('|') === HISTORY_HEADERS.join('|'), hist.rows[0].join('|'));
}

console.log('\n=== Planned but unticked sets are recorded as zero, not dropped ===');
{
  /* The live sheet has pushup rows reading "3 sets, 0 done" - three sets
     planned, none checked off. That row has to keep existing (the day did
     have pushups on the card) while contributing nothing to any total, so
     the app can tell "did not do it" apart from "was never scheduled". */
  const { rebuildHistoryFromWeekTabs_, getWorkoutHistory_ } = load([(() => {
    const rows = [WEEK_HEADERS.slice()];
    for (let sn = 1; sn <= 3; sn++) {
      rows.push(['2026-01-01', 'Monday', 'Pushups', sn, 'BW', 'BW', 55, '', 'No', '', '']);
    }
    rows.push(['2026-01-01', 'Monday', 'Leg Press', 1, 255, 255, 10, 10, 'Yes', '', 'Green']);
    return new Sheet('Week of Aug 24 - Aug 30, 2026', rows);
  })()]);
  rebuildHistoryFromWeekTabs_(false);
  const pu = getWorkoutHistory_().find(r => r.exercise === 'Pushups');
  check('the row exists', !!pu);
  check('three sets were planned', pu && pu.sets === 3, pu && String(pu.sets));
  check('none are counted as done', pu && pu.done === 0, pu && String(pu.done));
  check('and no reps are credited', pu && pu.totalReps === 0, pu && String(pu.totalReps));
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
