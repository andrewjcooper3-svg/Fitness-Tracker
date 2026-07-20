/**
 * iCloud Calendar CalDAV bridge - Cloudflare Worker
 *
 * Apps Script's UrlFetchApp can only issue GET/POST/PUT/PATCH/DELETE, but
 * CalDAV requires PROPFIND/REPORT - so this lives here instead, as a small
 * standalone Worker. Read-only: discovers your calendars and returns
 * upcoming events as JSON. Not a full RFC 4791/5545 implementation (no
 * recurrence expansion, no write support).
 *
 * Setup:
 *   1. Sign up free at https://dash.cloudflare.com (Workers & Pages).
 *   2. Create a new Worker, paste this whole file in as its code.
 *   3. Worker > Settings > Variables and Secrets > add two secrets
 *      (toggle "Encrypt"):
 *        APPLE_ID            your Apple ID email
 *        APPLE_APP_PASSWORD  an app-specific password from appleid.apple.com
 *                             (Sign-In and Security > App-Specific Passwords)
 *   4. Deploy. Copy the worker's URL (https://<name>.<subdomain>.workers.dev).
 *   5. Paste that URL into the webapp's Calendar tab config box.
 */

const CALDAV_BASE = 'https://caldav.icloud.com';

function basicAuthHeader(appleId, appPassword) {
  return 'Basic ' + btoa(`${appleId}:${appPassword}`);
}

// Issues a CalDAV request, manually following redirects (iCloud's root
// 301s to a per-account pod host) so the original method/body survives -
// letting fetch() auto-follow could silently downgrade PROPFIND/REPORT.
async function caldavRequest(url, method, body, auth, extraHeaders = {}) {
  const headers = {
    'Authorization': auth,
    'Content-Type': 'application/xml; charset=utf-8',
    ...extraHeaders
  };

  let response = await fetch(url, { method, headers, body, redirect: 'manual' });
  let redirectCount = 0;

  while ([301, 302, 307, 308].includes(response.status) && redirectCount < 5) {
    const location = response.headers.get('Location');
    if (!location) break;
    response = await fetch(location, { method, headers, body, redirect: 'manual' });
    redirectCount++;
  }

  return response;
}

// Minimal text extraction (no XML parser dependency, Workers don't ship
// one) - good enough for iCloud's fairly predictable CalDAV responses.
function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function extractAllBlocks(xml, tag) {
  const regex = new RegExp(`<[^:>]*:?${tag}[^>]*>[\\s\\S]*?<\\/[^:>]*:?${tag}>`, 'gi');
  return xml.match(regex) || [];
}

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    // CalDAV servers commonly encode embedded CR/LF (and other control
    // chars) inside calendar-data as numeric character references.
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

async function getCalDavHomeUrl(auth) {
  const principalBody = '<?xml version="1.0" encoding="utf-8" ?>' +
    '<A:propfind xmlns:A="DAV:"><A:prop><A:current-user-principal/></A:prop></A:propfind>';
  const principalRes = await caldavRequest(CALDAV_BASE + '/', 'PROPFIND', principalBody, auth, { Depth: '0' });
  if (!principalRes.ok) throw new Error(`CalDAV principal lookup failed (${principalRes.status}): ${(await principalRes.text()).slice(0, 300)}`);
  const principalXml = await principalRes.text();
  // Scope the href lookup to inside <current-user-principal> specifically -
  // the surrounding <response> has its own <href> for the requested
  // resource itself, which isn't the one we want.
  const principalPropBlock = extractTag(principalXml, 'current-user-principal');
  const principalPath = principalPropBlock ? extractTag(principalPropBlock, 'href') : null;
  if (!principalPath) throw new Error('Could not find current-user-principal in CalDAV response.');
  const principalUrl = /^https?:\/\//.test(principalPath) ? principalPath : (CALDAV_BASE + principalPath);

  const homeBody = '<?xml version="1.0" encoding="utf-8" ?>' +
    '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<A:prop><C:calendar-home-set/></A:prop></A:propfind>';
  const homeRes = await caldavRequest(principalUrl, 'PROPFIND', homeBody, auth, { Depth: '0' });
  if (!homeRes.ok) throw new Error(`CalDAV calendar-home-set lookup failed (${homeRes.status}): ${(await homeRes.text()).slice(0, 300)}`);
  const homeXml = await homeRes.text();
  const homePropBlock = extractTag(homeXml, 'calendar-home-set');
  const homePath = homePropBlock ? extractTag(homePropBlock, 'href') : null;
  if (!homePath) throw new Error('Could not find calendar-home-set in CalDAV response.');
  return /^https?:\/\//.test(homePath) ? homePath : (CALDAV_BASE + homePath);
}

async function listCalendars(homeUrl, auth) {
  const body = '<?xml version="1.0" encoding="utf-8" ?>' +
    '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<A:prop><A:resourcetype/><A:displayname/></A:prop></A:propfind>';
  const res = await caldavRequest(homeUrl, 'PROPFIND', body, auth, { Depth: '1' });
  if (!res.ok) throw new Error(`CalDAV calendar listing failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const xml = await res.text();
  const responses = extractAllBlocks(xml, 'response');

  const calendars = [];
  responses.forEach(resp => {
    const resourcetypeBlock = extractTag(resp, 'resourcetype');
    if (!resourcetypeBlock || !/<[^:>]*:?calendar\b/i.test(resourcetypeBlock)) return;
    const href = extractTag(resp, 'href');
    const name = extractTag(resp, 'displayname');
    if (!href) return;
    calendars.push({
      url: /^https?:\/\//.test(href) ? href : (CALDAV_BASE + href),
      name: name || 'Calendar'
    });
  });
  return calendars;
}

function fmtICSDate(d) {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

async function fetchEventsForCalendar(calUrl, startDate, endDate, auth) {
  const body = '<?xml version="1.0" encoding="utf-8" ?>' +
    '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
    '<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">' +
    `<C:time-range start="${fmtICSDate(startDate)}" end="${fmtICSDate(endDate)}"/>` +
    '</C:comp-filter></C:comp-filter></C:filter>' +
    '</C:calendar-query>';
  const res = await caldavRequest(calUrl, 'REPORT', body, auth, { Depth: '1' });
  if (!res.ok) throw new Error(`CalDAV event query failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const xml = await res.text();
  const dataBlocks = extractAllBlocks(xml, 'calendar-data');
  const events = [];
  dataBlocks.forEach(block => {
    const ics = extractTag(block, 'calendar-data');
    if (ics) events.push(...parseICSEvents(decodeXmlEntities(ics)));
  });
  return events;
}

// Minimal VEVENT parser - handles SUMMARY, DTSTART, DTEND (date-only and
// dateTime forms). Enough for a read-only display list; not a full
// RFC 5545 implementation (no recurrence expansion, no timezone tables).
function parseICSEvents(icsText) {
  const events = [];
  const veventBlocks = icsText.split('BEGIN:VEVENT').slice(1);
  veventBlocks.forEach(block => {
    const lines = block.split('END:VEVENT')[0].split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const event = { summary: '', start: null, end: null, allDay: false };
    lines.forEach(line => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const keyPart = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const key = keyPart.split(';')[0];

      if (key === 'SUMMARY') event.summary = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ');
      if (key === 'DTSTART') {
        event.allDay = keyPart.includes('VALUE=DATE') && !keyPart.includes('VALUE=DATE-TIME');
        event.start = parseICSDate(value, event.allDay);
      }
      if (key === 'DTEND') {
        event.end = parseICSDate(value, keyPart.includes('VALUE=DATE') && !keyPart.includes('VALUE=DATE-TIME'));
      }
    });
    if (event.summary && event.start) events.push(event);
  });
  return events;
}

function parseICSDate(value, allDay) {
  if (allDay) {
    const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const y = value.slice(0, 4), mo = value.slice(4, 6), d = value.slice(6, 8);
  const h = value.slice(9, 11), mi = value.slice(11, 13), s = value.slice(13, 15);
  if (value.slice(-1) === 'Z') {
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

async function getUpcomingCalendarEvents(days, env) {
  const auth = basicAuthHeader(env.APPLE_ID, env.APPLE_APP_PASSWORD);
  const homeUrl = await getCalDavHomeUrl(auth);
  const calendars = await listCalendars(homeUrl, auth);

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const allEvents = [];
  for (const cal of calendars) {
    try {
      const events = await fetchEventsForCalendar(cal.url, start, end, auth);
      events.forEach(ev => (ev.calendar = cal.name));
      allEvents.push(...events);
    } catch (e) {
      // Skip a calendar that errors rather than failing the whole request.
    }
  }

  allEvents.sort((a, b) => a.start - b.start);

  return allEvents.map(ev => ({
    summary: ev.summary,
    start: ev.start.toISOString(),
    end: ev.end ? ev.end.toISOString() : null,
    allDay: ev.allDay,
    calendar: ev.calendar
  }));
}

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      if (!env.APPLE_ID || !env.APPLE_APP_PASSWORD) {
        throw new Error('Set APPLE_ID and APPLE_APP_PASSWORD as Worker secrets (Settings > Variables and Secrets).');
      }
      const url = new URL(request.url);
      const days = parseInt(url.searchParams.get('days') || '14', 10);
      const events = await getUpcomingCalendarEvents(days, env);
      return new Response(JSON.stringify({ status: 'success', events }), {
        headers: { 'Content-Type': 'application/json', ...cors }
      });
    } catch (err) {
      return new Response(JSON.stringify({ status: 'error', message: err.message }), {
        headers: { 'Content-Type': 'application/json', ...cors }
      });
    }
  }
};
