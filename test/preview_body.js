// Renders the real BODY_PARTS/BODY_LINES from the app, big, with every
// shape outlined - so shape work is done against something I can see
// rather than against a 120px thumbnail.
const fs = require('fs');
const { chromium } = require('playwright');
const src = fs.readFileSync('/home/user/Fitness-Tracker/Workout_Tracker_AutoLog.html', 'utf8');
const grab = re => src.match(re)[0];
const code = grab(/function hxBlob_\([\s\S]*?\n\}/)
  + '\n' + grab(/const BODY_PARTS = \{[\s\S]*?\n\};/)
  + '\n' + grab(/const BODY_LINES = \{[\s\S]*?\n\};/)
  + '\nreturn { hxBlob_, BODY_PARTS, BODY_LINES };';
const { hxBlob_: blob, BODY_PARTS, BODY_LINES } = new Function(code)();

const W = 120, H = 250, GAP = 20;
let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W*2+GAP} ${H+14}" width="${(W*2+GAP)*3}" height="${(H+14)*3}">`;
out += `<rect width="100%" height="100%" fill="#ffffff"/>`;
Object.keys(BODY_PARTS).forEach((view, vi) => {
  out += `<g transform="translate(${vi*(W+GAP)},0)">`;
  BODY_PARTS[view].forEach(p => {
    const fill = p.m ? '#c9d8f7' : '#e3e6ee';
    const shape = p.t === 'ellipse'
      ? `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="${fill}" stroke="#5b8cff" stroke-width="0.5"/>`
      : `<path d="${blob(p.p, p.r)}" fill="${fill}" stroke="#5b8cff" stroke-width="0.5"/>`;
    out += shape;
    if (p.side === 'L') out += `<g transform="translate(${W},0) scale(-1,1)">${shape}</g>`;
  });
  (BODY_LINES[view]||[]).forEach(l => {
    const d = 'M' + l.pts.map(pt => pt.join(' ')).join('L');
    out += `<path d="${d}" fill="none" stroke="#1a2233" stroke-width="0.7" stroke-linecap="round" opacity="0.6"/>`;
    if (l.side === 'L') out += `<g transform="translate(${W},0) scale(-1,1)"><path d="${d}" fill="none" stroke="#1a2233" stroke-width="0.7" stroke-linecap="round" opacity="0.6"/></g>`;
  });
  // A light grid so vertices can be read off the picture.
  for (let y = 0; y <= H; y += 25) out += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ff6b6b" stroke-width="0.2" opacity="0.4"/><text x="1" y="${y-1}" font-size="4" fill="#ff6b6b">${y}</text>`;
  for (let x = 0; x <= W; x += 20) out += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ff6b6b" stroke-width="0.2" opacity="0.4"/><text x="${x+1}" y="6" font-size="4" fill="#ff6b6b">${x}</text>`;
  out += `<text x="${W/2}" y="${H+11}" text-anchor="middle" font-size="7" fill="#66738c">${view}</text></g>`;
});
out += '</svg>';
fs.writeFileSync('body_preview.svg', out);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: (W*2+GAP)*3, height: (H+14)*3 } });
  await p.goto('file://' + require('path').resolve('body_preview.svg'));
  await p.screenshot({ path: 'body_preview.png' });
  await b.close();
})();
