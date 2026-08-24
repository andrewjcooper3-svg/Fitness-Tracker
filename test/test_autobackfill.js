// The doGet path: asking for history when the rollup sheet is empty must
// build it from the week tabs, not return nothing.
const fs = require('fs');
let fails = 0;
const check = (l, ok, x='') => { console.log(`  ${ok?'PASS':'FAIL'}  ${l}${x?'  '+x:''}`); if(!ok) fails++; };

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  getSheetName(){return this.name;} setName(n){this.name=n;}
  getLastRow(){return this.rows.length;} getMaxRows(){return Math.max(this.rows.length,100);}
  appendRow(r){this.rows.push(r.slice());}
  setFrozenRows(){} setColumnWidth(){}
  getRange(r,c,nr,nc){const self=this;nr=nr===undefined?1:nr;nc=nc===undefined?1:nc;return{
    getValues(){const o=[];for(let i=0;i<nr;i++){const row=self.rows[r-1+i]||[];o.push(row.slice(c-1,c-1+nc));}return o;},
    getValue(){return (self.rows[r-1]||[])[c-1];},
    setValues(v){v.forEach((row,i)=>{while(self.rows.length<r-1+i)self.rows.push([]);self.rows[r-1+i]=row.slice();});},
    setValue(x){(self.rows[r-1]=self.rows[r-1]||[])[c-1]=x;},
    setFontWeight(){return this;},setBackground(){return this;},setFontColor(){return this;},
    setBorder(){return this;},setNumberFormat(){return this;},setHorizontalAlignment(){return this;}};}
  deleteRow(i){this.rows.splice(i-1,1);}
}
class SS {
  constructor(sh){this.sheets=sh;}
  getSheets(){return this.sheets.slice();}
  getSheetByName(n){return this.sheets.find(s=>s.name===n)||null;}
  insertSheet(n){const s=new Sheet(n);this.sheets.push(s);return s;}
  getSpreadsheetTimeZone(){return 'America/New_York';} getId(){return 'fake';}
}
const week = new Sheet('Week of Aug 17 - Aug 23, 2026', [
  ['Timestamp','Day','Exercise','Set','Target Weight','Actual Weight','Target Reps','Actual Reps','Completed','Notes','Quality'],
  ['2026-08-23','Monday','Leg Press',1,245,245,10,10,'Yes','','Green'],
  ['2026-08-23','Monday','Leg Press',2,245,245,10,10,'Yes','','Green'],
  ['2026-08-23','Wednesday','Lat Pulldown',1,100,100,10,10,'Yes','','Green']
]);
const ss = new SS([week]);
let output = null;
global.SpreadsheetApp={openById:()=>ss,create:()=>ss,BorderStyle:{SOLID_MEDIUM:1}};
global.PropertiesService={getScriptProperties:()=>({props:{SHEET_ID:'fake'},getProperty(k){return this.props[k];},setProperty(k,v){this.props[k]=v;}})};
global.Utilities={formatDate:(d,tz,f)=>{const p=n=>String(n).padStart(2,'0');
  return f==='yyyy-MM-dd'?`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`:d.toISOString();}};
global.Logger={log:()=>{}};
global.ContentService={createTextOutput:t=>{output=t;return{setMimeType:()=>t};},MimeType:{JSON:'json'}};

eval(fs.readFileSync('/home/user/Fitness-Tracker/code.gs','utf8'));

console.log('=== First ask, rollup sheet empty ===');
const first = JSON.parse(doGet({ parameter: { action: 'loadWorkoutHistory' } }));
console.log('  backfilled:', first.backfilled, '| rows:', first.history.length);
console.log('  ' + first.history.map(r => `${r.date} ${r.exercise} vol=${r.volume}`).join('\n  '));
check('it built itself instead of returning nothing', first.history.length === 2, String(first.history.length));
check('and reported how many days it built', first.backfilled === 2, String(first.backfilled));
check('dates resolved from the week label', first.history.some(r => r.date === '2026-08-17'));

console.log('\n=== Second ask, now populated ===');
const second = JSON.parse(doGet({ parameter: { action: 'loadWorkoutHistory' } }));
console.log('  backfilled:', second.backfilled, '| rows:', second.history.length);
check('does not walk the tabs again', second.backfilled === 0, String(second.backfilled));
check('same rows returned', second.history.length === 2, String(second.history.length));

console.log('\n=== Nothing logged at all ===');
{
  const bare = new SS([new Sheet('Weight Log', [['Date','Weight']])]);
  global.SpreadsheetApp = { openById:()=>bare, create:()=>bare, BorderStyle:{SOLID_MEDIUM:1} };
  const empty = JSON.parse(doGet({ parameter: { action: 'loadWorkoutHistory' } }));
  console.log('  ', JSON.stringify(empty));
  check('returns an empty list, not an error', empty.status === 'success' && empty.history.length === 0);
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails?1:0);
