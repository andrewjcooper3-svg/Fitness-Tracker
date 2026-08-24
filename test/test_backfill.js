// Runs the REAL backfillWorkoutHistory() / writeHistoryRollup_() from
// code.gs against a stubbed SpreadsheetApp, using week-tab data shaped like
// the actual log. Catches a broken backfill before it wastes a trip to the
// Apps Script editor.
const fs = require('fs');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  getSheetName() { return this.name; }
  setName(n) { this.name = n; }
  getLastRow() { return this.rows.length; }
  getMaxRows() { return Math.max(this.rows.length, 100); }
  appendRow(r) { this.rows.push(r.slice()); }
  setFrozenRows() {} setColumnWidth() {}
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
      getValue() { return (self.rows[r - 1] || [])[c - 1]; },
      setValues(vals) {
        vals.forEach((row, i) => {
          while (self.rows.length < r - 1 + i) self.rows.push([]);
          self.rows[r - 1 + i] = row.slice();
        });
      },
      setValue(v) { (self.rows[r - 1] = self.rows[r - 1] || [])[c - 1] = v; },
      setFontWeight() { return this; }, setBackground() { return this; },
      setFontColor() { return this; }, setBorder() { return this; },
      setNumberFormat() { return this; }, setHorizontalAlignment() { return this; }
    };
  }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
}

class SS {
  constructor(sheets) { this.sheets = sheets; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSpreadsheetTimeZone() { return 'America/New_York'; }
  getId() { return 'fake'; }
}

// One week tab shaped exactly like the exported log.
function weekSheet(name, entries) {
  const rows = [['Timestamp','Day','Exercise','Set','Target Weight','Actual Weight',
                 'Target Reps','Actual Reps','Completed','Notes','Quality']];
  entries.forEach(e => rows.push(e));
  return new Sheet(name, rows);
}

const monWeek = weekSheet('Week of Aug 17 - Aug 23, 2026', [
  ['2026-08-23','Monday','Leg Press',1,245,245,10,10,'Yes','','Green'],
  ['2026-08-23','Monday','Leg Press',2,245,245,10,10,'Yes','','Green'],
  ['2026-08-23','Monday','Leg Press',3,245,245,10,10,'Yes','','Green'],
  ['2026-08-23','Monday','Reverse Crunch',1,'BW','BW',20,20,'No','',''],
  ['2026-08-23','Monday','Reverse Crunch',2,'BW','BW',20,20,'No','',''],
  ['2026-08-23','Wednesday','Cable Crunch',1,70,70,15,15,'Yes','','Red'],
  ['2026-08-23','Wednesday','Cable Crunch',2,70,70,15,15,'Yes','','Red'],
  ['2026-08-23','Wednesday','Pushups',1,'BW','BW',55,55,'Yes','','Green'],
  ['2026-08-23','Saturday','Pushups',1,'BW','BW',55,35,'Yes','','Green'],
  ['2026-08-23','Saturday','Pushups',2,'BW','BW',55,100,'Yes','','Yellow']
]);
const other = new Sheet('Weight Log', [['Date','Weight (lb)']]);

const ss = new SS([monWeek, other]);

global.SpreadsheetApp = { openById: () => ss, create: () => ss, BorderStyle: { SOLID_MEDIUM: 1 } };
global.PropertiesService = { getScriptProperties: () => ({ props: { SHEET_ID: 'fake' },
  getProperty(k) { return this.props[k]; }, setProperty(k, v) { this.props[k] = v; } }) };
global.Utilities = { formatDate: (d, tz, fmt) => {
  const p = n => String(n).padStart(2, '0');
  return fmt === 'yyyy-MM-dd' ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
                              : d.toISOString();
} };
global.Logger = { log: m => console.log('  [Logger]', m) };

const src = fs.readFileSync('/home/user/Fitness-Tracker/code.gs', 'utf8');
// Everything except the doGet/doPost entry points, which need a request.
// Function declarations leak out of a sloppy eval; const does not, so the
// header list is handed back explicitly.
const { HISTORY_HEADERS } = eval(src.replace(/^function doGet[\s\S]*$/m, '') + '\n;({ HISTORY_HEADERS })');

console.log('=== backfillWorkoutHistory() on one real-shaped week tab ===');
const days = backfillWorkoutHistory();
const hx = ss.getSheetByName('Workout History');
check('the History sheet was created', !!hx);
check('it reported the days it wrote', days === 3, String(days));

const header = hx.rows[0];
const body = hx.rows.slice(1);
console.log('  header:', header.join(' | '));
body.forEach(r => console.log('   ', r.join(' | ')));

check('header matches HISTORY_HEADERS', header.join('|') === HISTORY_HEADERS.join('|'), header.join('|'));
check('a row per exercise per day', body.length === 5, String(body.length));

const lp = body.find(r => r[2] === 'Leg Press');
check('Leg Press dated to the Monday of that week', lp && lp[0] === '2026-08-17', lp && lp[0]);
check('Leg Press volume = 245 x 30', lp && lp[6] === 7350, lp && String(lp[6]));
check('Leg Press top weight', lp && lp[5] === 245, lp && String(lp[5]));
check('Leg Press quality mix 3 green', lp && lp[9] === 3 && lp[10] === 0 && lp[11] === 0);

const rc = body.find(r => r[2] === 'Reverse Crunch');
check('unfinished work recorded as 0 done of 2', rc && rc[3] === 2 && rc[4] === 0, rc && `${rc[3]}/${rc[4]}`);

const cc = body.find(r => r[2] === 'Cable Crunch');
check('Wednesday dated two days on', cc && cc[0] === '2026-08-19', cc && cc[0]);
check('reds counted', cc && cc[11] === 2, cc && String(cc[11]));

const sat = body.find(r => r[2] === 'Pushups' && r[1] === 'Saturday');
check('Saturday pushups dated to the 22nd', sat && sat[0] === '2026-08-22', sat && sat[0]);
check('bodyweight reps summed, no volume', sat && sat[8] === 135 && sat[6] === 0, sat && `${sat[8]}/${sat[6]}`);

console.log('\n=== Per-set records the rollup has to capture up front ===');
{
  // Heaviest set and best estimated 1RM come from DIFFERENT sets - the
  // whole reason these are computed at write time, not derived later.
  const r = rollupExercise_({ name:'Bench', sets:[
    { actualWeight:225, actualReps:3,  completed:true, quality:'yellow' },
    { actualWeight:185, actualReps:12, completed:true, quality:'green' }
  ]});
  console.log('  ', JSON.stringify(r));
  check('top weight is the heaviest set', r.topWeight === 225, String(r.topWeight));
  check('and its reps are kept', r.topSetReps === 3, String(r.topSetReps));
  check('best set volume is the 185x12', r.bestSetVolume === 2220, String(r.bestSetVolume));
  check('est 1RM comes from the lighter, longer set',
    Math.abs(r.est1RM - 259) < 1, String(r.est1RM));   // 185*(1+12/30)=259
}

console.log('\n=== Re-running does not duplicate ===');
const before = hx.rows.length;
backfillWorkoutHistory();
console.log('  rows:', before, '->', hx.rows.length);
check('same row count after a second run', hx.rows.length === before, `${before} -> ${hx.rows.length}`);

console.log('\n=== The read endpoint returns it ===');
const out = getWorkoutHistory_();
console.log('  ' + JSON.stringify(out[0]));
check('rows come back parsed', out.length === 5 && out[0].exercise && typeof out[0].volume === 'number');
check('dates are strings', typeof out[0].date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out[0].date), out[0].date);

console.log('\n=== A newly logged session updates its day in place ===');
writeSessionRows_('Week of Aug 17 - Aug 23, 2026', 'Monday', [
  { name: 'Leg Press', sets: [
    { setNum:1, targetWeight:255, actualWeight:255, targetReps:10, actualReps:10, completed:true, quality:'green' }
  ]}
], '', new Date());
const after = getWorkoutHistory_().filter(r => r.exercise === 'Leg Press');
console.log('  ' + JSON.stringify(after));
check('one Leg Press row, not two', after.length === 1, String(after.length));
check('it holds the new weight', after[0].topWeight === 255, String(after[0].topWeight));

console.log('\n=== A history sheet from an older column set rebuilds itself ===');
{
  const stale = new Sheet('Workout History', [
    ['Date','Day','Exercise','Sets','Sets Done','Top Weight','Volume','Target Reps','Total Reps','Green','Yellow','Red','Week'],
    ['2026-08-17','Monday','Leg Press',3,3,245,7350,10,30,3,0,0,'Week of Aug 17 - Aug 23, 2026']
  ]);
  const ss2 = new SS([monWeek, stale]);
  ss2.deleteSheet = function (sh) { this.sheets = this.sheets.filter(x => x !== sh); };
  global.SpreadsheetApp = { openById: () => ss2, create: () => ss2, BorderStyle: { SOLID_MEDIUM: 1 } };
  const fresh = getOrCreateHistorySheet_();
  console.log('  header now:', fresh.rows[0].join(' | '));
  check('the stale sheet was replaced', fresh.rows[0].join('|') === HISTORY_HEADERS.join('|'));
  check('and it starts empty so the backfill refills it', fresh.rows.length === 1, String(fresh.rows.length));
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
