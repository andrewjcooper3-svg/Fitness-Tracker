// The InBody numbers are transcribed by hand off printed result sheets,
// and a mistyped digit is invisible - it just draws a slightly wrong
// chart. So the internal arithmetic of each scan is checked against
// itself: the sheet's own totals have to reconcile.
const fs = require('fs');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const src = fs.readFileSync(__dirname + '/../Workout_Tracker_AutoLog.html', 'utf8');
const { INBODY_SCANS, INBODY_METRICS, INBODY_SEGMENTS } = new Function(
  src.match(/const INBODY_SCANS = \[[\s\S]*?\n\];/)[0]
  + '\n' + src.match(/const INBODY_METRICS = \{[\s\S]*?\n\};/)[0]
  + '\n' + src.match(/const INBODY_SEGMENTS = \[[\s\S]*?\n\];/)[0]
  + '\nreturn { INBODY_SCANS, INBODY_METRICS, INBODY_SEGMENTS };')();

const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log(`=== ${INBODY_SCANS.length} scans, each reconciling with itself ===`);
INBODY_SCANS.forEach(s => {
  console.log(`\n  ${s.date}`);
  // The sheet's own identities. If a digit was mistyped these stop adding up.
  check('ICW + ECW = total body water', near(s.icw + s.ecw, s.tbw, 0.15),
    `${s.icw} + ${s.ecw} = ${(s.icw + s.ecw).toFixed(1)} vs ${s.tbw}`);
  check('TBW + dry lean mass = lean body mass', near(s.tbw + s.dlm, s.lbm, 0.15),
    `${s.tbw} + ${s.dlm} = ${(s.tbw + s.dlm).toFixed(1)} vs ${s.lbm}`);
  check('lean body mass + body fat = weight', near(s.lbm + s.bfm, s.weight, 0.15),
    `${s.lbm} + ${s.bfm} = ${(s.lbm + s.bfm).toFixed(1)} vs ${s.weight}`);
  check('body fat mass / weight = percent body fat', near(s.bfm / s.weight * 100, s.pbf, 0.15),
    `${(s.bfm / s.weight * 100).toFixed(2)} vs ${s.pbf}`);
  check('ECW / TBW matches the printed ratio', near(s.ecw / s.tbw, s.ecwTbw, 0.002),
    `${(s.ecw / s.tbw).toFixed(4)} vs ${s.ecwTbw}`);
  check('TBW / LBM matches the printed ratio', near(s.tbw / s.lbm * 100, s.tbwLbm, 0.15),
    `${(s.tbw / s.lbm * 100).toFixed(2)} vs ${s.tbwLbm}`);
  // Both legs, as printed under Research Parameters.
  check('leg lean mass = both legs', near(s.seg.rightLeg.lean + s.seg.leftLeg.lean, s.legLean, 0.15),
    `${(s.seg.rightLeg.lean + s.seg.leftLeg.lean).toFixed(2)} vs ${s.legLean}`);
  // Segmental lean is dry-weight-free, so it lands near LBM but not on it;
  // this only catches a decimal point in the wrong place.
  const segLean = INBODY_SEGMENTS.reduce((n, [k]) => n + s.seg[k].lean, 0);
  check('segmental lean is in range of lean body mass', segLean > s.lbm * 0.75 && segLean <= s.lbm,
    `${segLean.toFixed(1)} vs ${s.lbm}`);
  const segFat = INBODY_SEGMENTS.reduce((n, [k]) => n + s.seg[k].fat, 0);
  check('segmental fat is in range of body fat mass', segFat > s.bfm * 0.75 && segFat <= s.bfm + 0.2,
    `${segFat.toFixed(1)} vs ${s.bfm}`);
  // BMI from the printed height, 5 ft 9 in.
  const bmi = (s.weight * 0.45359237) / Math.pow(69 * 0.0254, 2);
  check('BMI matches height and weight', near(bmi, s.bmi, 0.15), `${bmi.toFixed(2)} vs ${s.bmi}`);
});

console.log('\n=== Every scan carries every field ===');
const fields = Object.keys(INBODY_SCANS[0]);
INBODY_SCANS.forEach(s => {
  const missing = fields.filter(f => s[f] === undefined);
  check(`${s.date} is complete`, missing.length === 0, missing.join(', '));
  const segMissing = INBODY_SEGMENTS.filter(([k]) => !s.seg[k]).map(([, n]) => n);
  check(`${s.date} has all five segments`, segMissing.length === 0, segMissing.join(', '));
});

console.log('\n=== Scans are in chronological order ===');
const dates = INBODY_SCANS.map(s => s.date);
check('oldest first', dates.join() === dates.slice().sort().join(), dates.join(' '));

console.log('\n=== Every charted metric exists on every scan ===');
Object.keys(INBODY_METRICS).forEach(k => {
  const bad = INBODY_SCANS.filter(s => typeof s[k] !== 'number').map(s => s.date);
  check(`${k} present and numeric`, bad.length === 0, bad.join(', '));
});

console.log('\n=== Direction of good is set deliberately ===');
// good: 1 up is better, -1 down is better, 0 neither. An unset direction
// would silently colour a rising body-fat number green.
const badDir = Object.entries(INBODY_METRICS).filter(([, m]) => ![1, -1, 0].includes(m.good)).map(([k]) => k);
check('every metric declares one', badDir.length === 0, badDir.join(', '));
check('body fat counts down as good', INBODY_METRICS.pbf.good === -1);
check('muscle counts up as good', INBODY_METRICS.smm.good === 1);
check('weight is neutral', INBODY_METRICS.weight.good === 0);

console.log('\n=== The story the scans tell ===');
const first = INBODY_SCANS[0], last = INBODY_SCANS[INBODY_SCANS.length - 1];
console.log(`  weight ${first.weight} -> ${last.weight}   muscle ${first.smm} -> ${last.smm}`
  + `   body fat ${first.pbf}% -> ${last.pbf}%`);
const gained = last.weight - first.weight, lean = last.lbm - first.lbm;
console.log(`  gained ${gained.toFixed(1)} lb, of which ${lean.toFixed(1)} lb lean`);
check('recomposition: lean gain exceeds total weight gain', lean > gained,
  `${lean.toFixed(1)} lean vs ${gained.toFixed(1)} total`);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
