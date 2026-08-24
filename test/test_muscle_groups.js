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

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
