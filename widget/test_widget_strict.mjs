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
    pushups: { done: 730, plannedNow: 990, plannedWeek: 1045, deficit: -315 },
    water: { oz: 64, goal: 100 }
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
  for (const family of ['small', 'medium', 'large']) {
    const out = await draw(good, { family });
    console.log(`  ${family}: ${out}`);
    check(`${family} renders`, /STARTER/.test(out));
    if (family !== 'small') check(`${family} drew its bars`, (out.match(/\[img\]/g) || []).length === 2,
      String((out.match(/\[img\]/g) || []).length));
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
