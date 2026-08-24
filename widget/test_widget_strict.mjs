// Runs the real widget file against a STRICT Scriptable stub: anything the
// real API does not have throws, so an invented method fails here rather
// than on the phone.
import fs from 'fs';
import { makeScriptable, runWidget } from './scriptable-stub.mjs';

const SRC = '/home/user/Fitness-Tracker/widget/AJC-Fitness.js';
const EXEC = 'https://script.google.com/macros/s/AKfycbz123/exec';
let fails = 0;
const check = (l, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${x ? '\n         -> ' + x : ''}`); if (!ok) fails++; };

const source = (url = EXEC) => fs.readFileSync(SRC, 'utf8')
  .replace("const DEPLOYMENT_URL = '';", `const DEPLOYMENT_URL = '${url}';`);

async function draw(body, { family = 'medium', statusCode = 200, url = EXEC } = {}) {
  const stubs = makeScriptable({ body, statusCode, family });
  await runWidget(source(url), stubs);
  return stubs.drawn.join(' | ');
}

const now = new Date();
const iso = h => new Date(now.getTime() + h * 3600000).toISOString();
const good = JSON.stringify({
  status: 'success',
  summary: {
    updatedAt: now.toISOString(),
    starter: { stage: 'active', level: 'ok', location: 'counter', fedAt: iso(-4), dueAt: iso(+5), peakAt: iso(+0.85) },
    pushups: {
      done: 730, plannedNow: 990, plannedWeek: 1045, deficit: -315,
      today: 55, todayTarget: 165,
      // Mon done, Tue MISSED, Wed done, today partial, then the future.
      days: [
        { done: 165, target: 165, today: false, future: false },
        { done: 0,   target: 165, today: false, future: false },
        { done: 165, target: 165, today: false, future: false },
        { done: 55,  target: 165, today: true,  future: false },
        { done: 0,   target: 165, today: false, future: true },
        { done: 0,   target: 220, today: false, future: true },
        { done: 0,   target: 0,   today: false, future: true }
      ]
    },
    lift: { today: false, day: 'Wednesday', inDays: 6, count: 13 },
    water: { oz: 64, goal: 100 }
  }
});

// Today's work finished, so the headline should flip from a gap to a tick.
const doneToday = JSON.stringify({
  status: 'success',
  summary: {
    updatedAt: now.toISOString(),
    starter: { stage: 'none' },
    pushups: { done: 900, plannedNow: 990, plannedWeek: 1045, deficit: -100,
      today: 165, todayTarget: 165,
      days: [{ done: 165, target: 165, today: true, future: false }] },
    lift: { today: true, day: 'Monday', count: 12, headline: 'Leg Press · Leg Curl · RDL' }
  }
});

// Sunday: nothing was asked for, which is not the same as nothing done.
const restDay = JSON.stringify({
  status: 'success',
  summary: {
    updatedAt: now.toISOString(),
    starter: { stage: 'none' },
    pushups: { done: 1045, plannedNow: 1045, plannedWeek: 1045, deficit: 0,
      today: 0, todayTarget: 0,
      days: [{ done: 0, target: 0, today: true, future: false }] },
    lift: { today: false, day: 'Monday', inDays: 1, count: 12 }
  }
});

(async () => {
  console.log('=== The strict stub catches an invented API (proving it works) ===');
  {
    const stubs = makeScriptable({ body: good });
    let threw = null;
    try {
      // Exactly the call that failed on the phone.
      const dc = new stubs.DrawContext();
      dc.fillRoundedRect(new stubs.Rect(0, 0, 10, 10), 5, 5);
    } catch (e) { threw = e.message; }
    console.log('  ', threw);
    check('fillRoundedRect is rejected by the stub', /not part of the Scriptable API/.test(threw || ''), String(threw));
  }

  console.log('\n=== The widget draws at every size, bars included ===');
  // Small no longer gives the starter a header - pushups took that space,
  // and the starter drops to a single coloured line at the bottom.
  const EXPECT = { small: { starter: /Peaks|Feed it|No starter|Day \d/, imgs: 1 },
                   medium: { starter: /STARTER/, imgs: 2 },
                   large:  { starter: /STARTER/, imgs: 3 } };
  for (const family of ['small', 'medium', 'large']) {
    const out = await draw(good, { family });
    console.log(`  ${family}: ${out}`);
    check(`${family} still shows the starter`, EXPECT[family].starter.test(out), out);
    // small: dot strip. medium: dots + water bar. large: dots + pushup +
    // water bars.
    check(`${family} drew ${EXPECT[family].imgs} image(s)`,
      (out.match(/\[img\]/g) || []).length === EXPECT[family].imgs,
      String((out.match(/\[img\]/g) || []).length));
  }

  console.log('\n=== Today leads, not the week ===');
  for (const family of ['small', 'medium', 'large']) {
    const out = await draw(good, { family });
    check(`${family} shows the gap left today`, /110/.test(out) && /to go of 165/.test(out), out);
    check(`${family} labels it as today`, /PUSHUPS TODAY/.test(out), out);
  }
  {
    const out = await draw(doneToday, { family: 'small' });
    console.log('  done:', out);
    check('a finished day shows a tick, not a zero', /✓/.test(out) && /165 done/.test(out), out);
    const rest = await draw(restDay, { family: 'small' });
    console.log('  rest:', rest);
    check('a rest day says so rather than showing 0 to go', /Rest day/.test(rest), rest);
  }

  console.log('\n=== The week strip and the next lift ===');
  {
    const out = await draw(good, { family: 'medium' });
    // Dots are a drawn image on the home screen, so what is checkable here
    // is that it drew one - the Lock Screen variant below is text.
    check('the dot strip is drawn', (out.match(/\[img\]/g) || []).length >= 2, out);
    check('the next lift is named', /Next lift Wednesday/.test(out), out);
    const today = await draw(doneToday, { family: 'medium' });
    check('and on a lifting day it says so', /Lift today/.test(today), today);
    check('with the session headline', /Leg Press/.test(today), today);
  }

  console.log('\n=== Lock Screen ===');
  for (const family of ['accessoryCircular', 'accessoryRectangular', 'accessoryInline']) {
    const out = await draw(good, { family });
    console.log(`  ${family}: ${out}`);
    check(`${family} renders`, out.length > 0, out);
  }
  {
    const inline = await draw(good, { family: 'accessoryInline' });
    check('inline states the gap', /110 pushups to go/.test(inline), inline);
    check('inline says done when it is', /Pushups done/.test(await draw(doneToday, { family: 'accessoryInline' })));
    check('inline handles the rest day', /rest day/.test(await draw(restDay, { family: 'accessoryInline' })));

    const circ = await draw(good, { family: 'accessoryCircular' });
    check('the circular ring drew and carries the number', /\[img\]/.test(circ) && /110/.test(circ), circ);
    check('a finished day shows a tick in the ring', /✓/.test(await draw(doneToday, { family: 'accessoryCircular' })));

    const rect = await draw(good, { family: 'accessoryRectangular' });
    console.log('  rect:', rect);
    check('rectangular leads with the gap', /110 pushups to go/.test(rect), rect);
    // Filled, missed and not-yet must be three different marks, or a
    // Monday morning looks identical to a week of skipped days.
    check('its dots distinguish done, missed and future',
      /● ✕ ● .* ○ ○ ·/.test(rect.replace(/\s+/g, ' ')), rect);
    check('rectangular names the next lift', /Next lift Wednesday/.test(rect), rect);
  }

  console.log('\n=== Starter states ===');
  for (const [name, starter, re] of [
    ['none',      { stage: 'none' },                                                /No starter/],
    ['building',  { stage: 'building', headline: 'Day 3 of 14', sub: 'Same feed' },  /Day 3 of 14/],
    ['no feeds',  { stage: 'active', level: 'none' },                                /No feeds yet/],
    ['due',       { stage: 'active', level: 'due', fedAt: iso(-9) },                 /Feed it/],
    ['overdue',   { stage: 'active', level: 'overdue', fedAt: iso(-14) },            /Feed it/],
    ['past peak', { stage: 'active', level: 'ok', peakAt: iso(-2), dueAt: iso(+3) }, /Peaked/]
  ]) {
    const out = await draw(JSON.stringify({ status: 'success', summary: { updatedAt: now.toISOString(), starter } }));
    check(name, re.test(out), out);
  }

  console.log('\n=== Error paths still render (they draw no bars) ===');
  for (const [name, body, opts, re] of [
    ['sign-in page',   '<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head></html>', {}, /Who has access/],
    ['backend threw',  '<html><body>TypeError: Cannot read properties of null</body></html>', {}, /backend threw/i],
    ['stale deploy',   JSON.stringify({ status: 'ok', backendVersion: '2026-08-21' }), {}, /predates the widget endpoint/],
    ['not published',  JSON.stringify({ status: 'success', summary: null }), {}, /open the tracker once/],
    ['offline',        new Error('The internet connection appears to be offline.'), {}, /offline/],
    ['/dev url',       good, { url: 'https://script.google.com/macros/s/AKfycbz123/dev' }, /only works while you are signed into/]
  ]) {
    const out = await draw(body, opts);
    check(name, re.test(out), out);
  }

  console.log('\n=== Countdown computed at draw time ===');
  {
    const out = await draw(good);
    check('live countdown', /in 5[01]m/.test(out), out.split(' | ').find(t => /in \d/.test(t)) || out);
  }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`);
  process.exit(fails ? 1 : 0);
})();
