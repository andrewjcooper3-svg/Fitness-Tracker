// The muscle-distribution chart is only as honest as its classifier, and a
// misfiled exercise is invisible - the bar just looks wrong and you assume
// it's your training. So the mapping gets pinned.
//
// The bug this was written for: /curl(?!.*leg)/ claimed "Leg Curl" for
// Biceps. The lookahead checks for "leg" AFTER the word "curl", and in
// "Leg Curl" the leg is in front of it, so every hamstring set was being
// counted as an arm set.
const fs = require('fs');
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); if (!ok) fails++; };

const src = fs.readFileSync(__dirname + '/../Workout_Tracker_AutoLog.html', 'utf8');
eval(src.match(/const MUSCLE_PATTERNS = \[[\s\S]*?\n\];/)[0]
   + '\n' + src.match(/function muscleFor_\(name\) \{[\s\S]*?\n\}/)[0]);

const expect = {
  Chest: ['Bench Press', 'Incline Dumbbell Press', 'Dumbbell Press', 'Chest Fly', 'Pec Deck',
          'Cable Fly', 'Pushups', 'Push-ups', 'Dips', 'Decline Press', 'Cable Crossover'],
  Back: ['Lat Pulldown', 'Pulldown', 'Pull Up', 'Pull-up', 'Chin Up', 'Chin-up', 'Barbell Row',
         'Seated Row', 'Chest Supported Row', 'T-Bar Row', 'Pullover', 'Back Extension'],
  Shoulders: ['Overhead Press', 'Push Press', 'Arnold Press', 'Lateral Raise', 'Front Raise',
              'Rear Delt Fly', 'Face Pull', 'Shrug', 'Upright Row', 'Military Press'],
  Biceps: ['Bicep Curl', 'Hammer Curl', 'Preacher Curl', 'Cable Curl', 'Incline Curl'],
  Triceps: ['Tricep Pushdown', 'Rope Pushdown', 'Rope Pulldown', 'Skull Crusher',
            'Overhead Tricep Extension', 'Close-Grip Bench'],
  Quads: ['Leg Press', 'Squat', 'Front Squat', 'Bulgarian Split Squat', 'Leg Extension',
          'Lunge', 'Hack Squat', 'Step-up'],
  Hamstrings: ['Leg Curl', 'Seated Leg Curl', 'Lying Leg Curl', 'Romanian Deadlift',
               'Deadlift', 'RDL', 'Good Morning', 'Nordic Curl'],
  Glutes: ['Hip Thrust', 'Glute Kickback', 'Hip Abduction', 'Glute Bridge'],
  Calves: ['Calf Raise', 'Seated Calf Raise'],
  Core: ['Cable Crunch', 'Reverse Crunch', 'Plank', 'Hanging Knee Raise', 'Leg Raise',
         'Russian Twist', 'Ab Wheel', 'Sit-up', 'Pallof Press'],
  'Cardio & other': ['Treadmill Walk', 'Stationary Bike', 'Rowing Machine', 'Row Erg',
                     'Sauna', 'Mobility Flow', 'Yoga']
};

console.log('=== Every exercise lands in the right group ===');
Object.entries(expect).forEach(([group, names]) => {
  const wrong = names.filter(n => muscleFor_(n) !== group).map(n => `${n}→${muscleFor_(n)}`);
  check(`${group} (${names.length})`, wrong.length === 0, wrong.join(', '));
});

console.log('\n=== The specific traps ===');
// Order-dependent pairs: if one pattern is moved above another these break.
const traps = [
  ['Leg Curl', 'Hamstrings', 'a curl that is not an arm curl'],
  ['Seated Leg Curl', 'Hamstrings', 'same, with a qualifier in front'],
  ['Rope Pulldown', 'Triceps', 'named like a back move, is not one'],
  ['Upright Row', 'Shoulders', 'a row that is not back work'],
  ['Rowing Machine', 'Cardio & other', 'a row that is not a lift at all'],
  ['Row Erg', 'Cardio & other', 'same'],
  ['Rear Delt Fly', 'Shoulders', 'a fly that is not a chest fly'],
  ['Face Pull', 'Shoulders', 'a pull that is not a pulldown'],
  ['Close-Grip Bench', 'Triceps', 'a bench that is not chest work'],
  ['Glute Kickback', 'Glutes', 'not hamstrings'],
  ['Pull Up', 'Back', 'the space used to send this to Other'],
  ['Chin Up', 'Back', 'likewise'],
  ['Leg Raise', 'Core', 'not a quad move'],
  ['Calf Raise', 'Calves', 'not a lateral raise']
];
traps.forEach(([name, group, why]) => {
  const got = muscleFor_(name);
  check(`${name} → ${group} (${why})`, got === group, `got ${got}`);
});

console.log('\n=== Nothing real falls into Other ===');
const everything = Object.values(expect).flat();
const orphans = everything.filter(n => muscleFor_(n) === 'Other');
check('no exercise is unclassified', orphans.length === 0, orphans.join(', '));

// Other still has to exist as a bucket - silently dropping an exercise the
// patterns don't know is worse than admitting the gap.
check('an unknown exercise still gets a home', muscleFor_('Zercher Widowmaker') === 'Other',
  muscleFor_('Zercher Widowmaker'));

/* ---- Weighted attribution ---- */
// A `const` does not escape a sloppy eval, though a function declaration
// does - so muscleSplit_ lands here on its own, while the three tables have
// to be handed back out through the eval's completion value.
const { MUSCLE_SPLIT_OVERRIDES, MUSCLE_SPLIT_DEFAULTS, BODY_PARTS } = eval(
  src.match(/const MUSCLE_SPLIT_OVERRIDES = \[[\s\S]*?\n\];/)[0]
  + '\n' + src.match(/const MUSCLE_SPLIT_DEFAULTS = \{[\s\S]*?\n\};/)[0]
  + '\n' + src.match(/function muscleSplit_\(name\) \{[\s\S]*?\n\}/)[0]
  + '\n' + src.match(/const BODY_PARTS = \{[\s\S]*?\n\};/)[0]
  + '\n;({ MUSCLE_SPLIT_OVERRIDES, MUSCLE_SPLIT_DEFAULTS, BODY_PARTS })');

console.log('\n=== Every split adds up to exactly one set ===');
// If a split summed to 1.2, weighted mode would silently inflate the
// totals and the two modes would stop being comparable.
const near1 = o => Math.abs(Object.values(o).reduce((a, b) => a + b, 0) - 1) < 1e-9;
const badOverride = MUSCLE_SPLIT_OVERRIDES.filter(([, o]) => !near1(o))
  .map(([re, o]) => `${re} = ${Object.values(o).reduce((a, b) => a + b, 0)}`);
check('every override sums to 1', badOverride.length === 0, badOverride.join('; '));
const badDefault = Object.entries(MUSCLE_SPLIT_DEFAULTS).filter(([, o]) => !near1(o))
  .map(([k, o]) => `${k} = ${Object.values(o).reduce((a, b) => a + b, 0)}`);
check('every default sums to 1', badDefault.length === 0, badDefault.join('; '));

const everyName = Object.values(expect).flat();
const badResolved = everyName.filter(n => !near1(muscleSplit_(n)));
check('and so does every resolved exercise', badResolved.length === 0, badResolved.join(', '));

console.log('\n=== Splits only name groups that exist ===');
const known = new Set([...Object.keys(expect), 'Other']);
const unknownGroups = new Set();
[...MUSCLE_SPLIT_OVERRIDES.map(([, o]) => o), ...Object.values(MUSCLE_SPLIT_DEFAULTS)]
  .forEach(o => Object.keys(o).forEach(g => { if (!known.has(g)) unknownGroups.add(g); }));
check('no split invents a muscle group', unknownGroups.size === 0, [...unknownGroups].join(', '));

console.log('\n=== Weighted actually spreads the compounds ===');
const spread = [
  ['Bench Press', 'Chest', ['Triceps', 'Shoulders']],
  ['Pushups', 'Chest', ['Triceps', 'Shoulders']],
  ['Barbell Row', 'Back', ['Biceps']],
  ['Pull Up', 'Back', ['Biceps']],
  ['Squat', 'Quads', ['Glutes', 'Hamstrings']],
  ['Deadlift', 'Hamstrings', ['Glutes', 'Back']],
  ['Romanian Deadlift', 'Hamstrings', ['Glutes']]
];
spread.forEach(([name, primary, alsoHits]) => {
  const split = muscleSplit_(name);
  const top = Object.keys(split).sort((a, b) => split[b] - split[a])[0];
  const missing = alsoHits.filter(g => !(split[g] > 0));
  check(`${name} leads with ${primary} and also hits ${alsoHits.join(' + ')}`,
    top === primary && missing.length === 0,
    `top ${top}${missing.length ? ', missing ' + missing.join(',') : ''}`);
});

console.log('\n=== Isolation work stays on one muscle ===');
[['Leg Extension', 'Quads'], ['Leg Curl', 'Hamstrings'], ['Bicep Curl', 'Biceps'],
 ['Tricep Pushdown', 'Triceps'], ['Lateral Raise', 'Shoulders'], ['Calf Raise', 'Calves'],
 ['Cable Crunch', 'Core'], ['Chest Fly', 'Chest']].forEach(([name, group]) => {
  const split = muscleSplit_(name);
  check(`${name} is all ${group}`, split[group] === 1 && Object.keys(split).length === 1,
    JSON.stringify(split));
});

console.log('\n=== The body diagram covers every group ===');
const drawn = new Set();
Object.values(BODY_PARTS).forEach(parts => parts.forEach(p => { if (p.m) drawn.add(p.m); }));
// Cardio has no muscle to shade; everything else must be somewhere on the body.
const needed = Object.keys(expect).filter(g => g !== 'Cardio & other');
const notDrawn = needed.filter(g => !drawn.has(g));
check('every muscle group has a region', notDrawn.length === 0, notDrawn.join(', '));
const phantom = [...drawn].filter(g => !known.has(g));
check('no region maps to a group that cannot occur', phantom.length === 0, phantom.join(', '));

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
