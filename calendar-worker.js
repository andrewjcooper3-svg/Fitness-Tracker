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
    if (!resourcetypeBlock) return;
    // Apple marks a calendar you added via "Subscribe to Calendar" (e.g. a
    // public F1/sports/holiday feed) with <CS:subscribed/> in resourcetype
    // instead of - not in addition to - the standard <C:calendar/> element
    // used for calendars you own or that were shared with you directly.
    // Both need accepting, or subscribed calendars never surface.
    const isCalendar = /<[^:>]*:?calendar\b/i.test(resourcetypeBlock);
    const isSubscribed = /<[^:>]*:?subscribed\b/i.test(resourcetypeBlock);
    if (!isCalendar && !isSubscribed) return;
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

// Diagnostic-only: every collection under the home-set, unfiltered, with
// its raw resourcetype text - used to figure out what marker a calendar
// that isn't surfacing (e.g. a subscription) actually carries, instead of
// guessing at another resourcetype variant blind.
async function listAllCollectionsRaw(homeUrl, auth) {
  const body = '<?xml version="1.0" encoding="utf-8" ?>' +
    '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<A:prop><A:resourcetype/><A:displayname/></A:prop></A:propfind>';
  const res = await caldavRequest(homeUrl, 'PROPFIND', body, auth, { Depth: '1' });
  if (!res.ok) throw new Error(`CalDAV calendar listing failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const xml = await res.text();
  const responses = extractAllBlocks(xml, 'response');

  return responses.map(resp => ({
    href: extractTag(resp, 'href'),
    displayname: extractTag(resp, 'displayname'),
    resourcetype: extractTag(resp, 'resourcetype')
  }));
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
    if (!ics) return;
    // The server's time-range filter matches a recurring VEVENT if *any*
    // of its occurrences fall in range, but still returns the master
    // event's original DTSTART/RRULE, not the specific matching
    // occurrence - so recurring events need expanding against the same
    // range here to find which occurrence(s) are actually relevant.
    parseICSEvents(decodeXmlEntities(ics)).forEach(ev => {
      events.push(...expandRecurrence(ev, startDate, endDate));
    });
  });
  return events;
}

// Same REPORT query as fetchEventsForCalendar, but returns the decoded
// ICS text untouched - diagnostic only, so the actual VEVENT shape (or
// the fact that zero calendar-data blocks came back at all) can be seen
// directly for a calendar returning no events unexpectedly.
async function fetchRawIcsForCalendar(calUrl, startDate, endDate, auth) {
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
  if (dataBlocks.length === 0) {
    // Nothing matched the time-range filter at all - include a slice of
    // the raw multistatus response so it's clear whether that's because
    // the query genuinely found nothing, or the response shape is
    // different than expected (e.g. an error buried in a 207).
    return { blockCount: 0, rawResponseSample: xml.slice(0, 1000) };
  }
  return { blockCount: dataBlocks.length, ics: dataBlocks.map(b => decodeXmlEntities(extractTag(b, 'calendar-data') || '')) };
}

// Minimal VEVENT parser - handles SUMMARY, DTSTART, DTEND, RRULE, EXDATE
// (date-only and dateTime forms). Enough for a read-only display list;
// not a full RFC 5545 implementation (no RDATE, no RECURRENCE-ID
// overrides for individually-edited occurrences).
function parseICSEvents(icsText) {
  const events = [];
  const veventBlocks = icsText.split('BEGIN:VEVENT').slice(1);
  veventBlocks.forEach(block => {
    const lines = block.split('END:VEVENT')[0].split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const event = { summary: '', start: null, end: null, allDay: false, rrule: null, exdates: [] };
    lines.forEach(line => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const keyPart = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const key = keyPart.split(';')[0];

      const tzidMatch = keyPart.match(/TZID=([^;]+)/);
      const tzid = tzidMatch ? tzidMatch[1] : null;

      if (key === 'SUMMARY') event.summary = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ');
      if (key === 'DTSTART') {
        event.allDay = keyPart.includes('VALUE=DATE') && !keyPart.includes('VALUE=DATE-TIME');
        event.start = parseICSDate(value, event.allDay, tzid);
      }
      if (key === 'DTEND') {
        event.end = parseICSDate(value, keyPart.includes('VALUE=DATE') && !keyPart.includes('VALUE=DATE-TIME'), tzid);
      }
      if (key === 'RRULE') event.rrule = parseRRule(value);
      if (key === 'EXDATE') {
        const exAllDay = keyPart.includes('VALUE=DATE') && !keyPart.includes('VALUE=DATE-TIME');
        value.split(',').forEach(v => event.exdates.push(parseICSDate(v, exAllDay, tzid).getTime()));
      }
    });
    if (event.summary && event.start) events.push(event);
  });
  return events;
}

function parseRRule(value) {
  const rule = {};
  value.split(';').forEach(part => {
    const [k, v] = part.split('=');
    if (k) rule[k] = v;
  });
  return rule;
}

// Expands a (possibly recurring) event into every occurrence that
// overlaps [rangeStart, rangeEnd]. Supports FREQ=DAILY/WEEKLY/MONTHLY/
// YEARLY with INTERVAL/COUNT/UNTIL - covers ordinary bills, paydays, and
// similar simple recurring events; does not implement BYDAY/BYMONTHDAY/
// BYSETPOS or other fine-grained RRULE parts.
function expandRecurrence(event, rangeStart, rangeEnd) {
  const duration = event.end ? (event.end.getTime() - event.start.getTime()) : 0;

  if (!event.rrule) {
    const occEnd = event.end || event.start;
    if (occEnd >= rangeStart && event.start <= rangeEnd) {
      return [{ summary: event.summary, allDay: event.allDay, start: event.start, end: event.end }];
    }
    return [];
  }

  const freq = event.rrule.FREQ;
  const interval = parseInt(event.rrule.INTERVAL || '1', 10) || 1;
  const count = event.rrule.COUNT ? parseInt(event.rrule.COUNT, 10) : null;
  const until = event.rrule.UNTIL ? parseICSDate(event.rrule.UNTIL, !event.rrule.UNTIL.includes('T'), null) : null;
  const exdateSet = new Set(event.exdates);

  const occurrences = [];
  const current = new Date(event.start);
  let occurrenceIndex = 0;
  let iterations = 0;
  const maxIterations = 2000; // safety cap against unbounded/malformed rules

  while (iterations < maxIterations) {
    iterations++;
    if (count != null && occurrenceIndex >= count) break;
    if (until && current > until) break;
    if (current > rangeEnd) break;

    if (!exdateSet.has(current.getTime())) {
      const occEnd = duration ? new Date(current.getTime() + duration) : null;
      if ((occEnd || current) >= rangeStart && current <= rangeEnd) {
        occurrences.push({ summary: event.summary, allDay: event.allDay, start: new Date(current), end: occEnd });
      }
    }

    occurrenceIndex++;
    if (freq === 'DAILY') current.setUTCDate(current.getUTCDate() + interval);
    else if (freq === 'WEEKLY') current.setUTCDate(current.getUTCDate() + 7 * interval);
    else if (freq === 'MONTHLY') current.setUTCMonth(current.getUTCMonth() + interval);
    else if (freq === 'YEARLY') current.setUTCFullYear(current.getUTCFullYear() + interval);
    else break; // unsupported FREQ - stop rather than loop forever
  }

  return occurrences;
}

// Resolves a named IANA zone's UTC offset at a given instant (DST-aware)
// using Intl, the same trick used client-side for Eastern time - Workers
// ship full ICU data so this works for any zone, not just one hardcoded.
function getTzOffsetMs(instant, tzid) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  fmt.formatToParts(instant).forEach(p => { parts[p.type] = p.value; });
  const asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return asIfUTC - instant.getTime();
}

// Converts a wall-clock Y/M/D H:M:S reading in a named zone to the true
// UTC instant it represents. Two passes to converge correctly even right
// at a DST transition edge, where the offset used to make the first
// guess might not match the offset actually in effect.
function convertNamedTzToUtc(y, mo, d, h, mi, s, tzid) {
  let guess = new Date(Date.UTC(y, mo, d, h, mi, s));
  for (let i = 0; i < 2; i++) {
    const offsetMs = getTzOffsetMs(guess, tzid);
    guess = new Date(Date.UTC(y, mo, d, h, mi, s) - offsetMs);
  }
  return guess;
}

// DTSTART/DTEND values come in three shapes: a bare date (all-day, no
// time/zone at all), a UTC instant suffixed with "Z", or - very common
// for events created directly in Apple Calendar - a local wall-clock
// value paired with a TZID parameter that must be resolved to know what
// UTC instant it actually is.
function parseICSDate(value, allDay, tzid) {
  if (allDay) {
    const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  const y = Number(value.slice(0, 4)), mo = Number(value.slice(4, 6)), d = Number(value.slice(6, 8));
  const h = Number(value.slice(9, 11)), mi = Number(value.slice(11, 13)), s = Number(value.slice(13, 15) || '0');

  if (value.slice(-1) === 'Z') {
    return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  }
  if (tzid) {
    return convertNamedTzToUtc(y, mo - 1, d, h, mi, s, tzid);
  }
  // No TZID and no Z suffix: a "floating" time with no defined zone at
  // all (rare from iCloud in practice). UTC is the least-wrong fallback.
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

// start/end are Dates already resolved to absolute UTC instants by the
// caller - the Worker itself has no concept of "today" that matches the
// user's timezone (it effectively runs on UTC), so it must never compute
// that boundary itself.
async function getUpcomingCalendarEvents(start, end, env) {
  const auth = basicAuthHeader(env.APPLE_ID, env.APPLE_APP_PASSWORD);
  const homeUrl = await getCalDavHomeUrl(auth);
  const calendars = await listCalendars(homeUrl, auth);

  const allEvents = [];
  const calendarSummaries = [];
  for (const cal of calendars) {
    try {
      const events = await fetchEventsForCalendar(cal.url, start, end, auth);
      events.forEach(ev => (ev.calendar = cal.name));
      allEvents.push(...events);
      calendarSummaries.push({ name: cal.name, eventCount: events.length });
    } catch (e) {
      // Skip a calendar that errors rather than failing the whole request,
      // but surface it in the diagnostics below instead of silently
      // dropping it.
      calendarSummaries.push({ name: cal.name, error: e.message });
    }
  }

  allEvents.sort((a, b) => a.start - b.start);

  const events = allEvents.map(ev => ({
    summary: ev.summary,
    start: ev.start.toISOString(),
    end: ev.end ? ev.end.toISOString() : null,
    allDay: ev.allDay,
    calendar: ev.calendar
  }));

  return { events, calendars: calendarSummaries };
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

      if (url.searchParams.get('debug') === 'collections') {
        const auth = basicAuthHeader(env.APPLE_ID, env.APPLE_APP_PASSWORD);
        const homeUrl = await getCalDavHomeUrl(auth);
        const collections = await listAllCollectionsRaw(homeUrl, auth);
        return new Response(JSON.stringify({ status: 'success', collections }, null, 2), {
          headers: { 'Content-Type': 'application/json', ...cors }
        });
      }

      // Bypasses all parsing/expansion and returns the exact ICS text
      // iCloud sends back for one calendar's REPORT query, so a calendar
      // returning 0 events (like a subscription) can be inspected directly
      // instead of guessing why the parser found nothing.
      if (url.searchParams.get('debug') === 'raw') {
        const nameFilter = (url.searchParams.get('calendar') || '').toLowerCase();
        const auth = basicAuthHeader(env.APPLE_ID, env.APPLE_APP_PASSWORD);
        const homeUrl = await getCalDavHomeUrl(auth);
        const calendars = await listCalendars(homeUrl, auth);
        const match = calendars.find(c => c.name.toLowerCase().includes(nameFilter));
        if (!match) {
          return new Response(JSON.stringify({ status: 'error', message: `No calendar name contains "${nameFilter}". Found: ${calendars.map(c => c.name).join(', ')}` }), {
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        const rawStart = new Date(); rawStart.setUTCHours(0, 0, 0, 0);
        const rawEnd = new Date(rawStart); rawEnd.setUTCDate(rawEnd.getUTCDate() + days);
        const raw = await fetchRawIcsForCalendar(match.url, rawStart, rawEnd, auth);
        return new Response(JSON.stringify({ status: 'success', calendar: match.name, ...raw }, null, 2), {
          headers: { 'Content-Type': 'application/json', ...cors }
        });
      }

      // Tests whether a plain GET on the calendar's own collection URL
      // returns its content directly (some subscribed/read-only calendars
      // are served this way, as one flat ICS document, rather than
      // supporting per-event REPORT queries the way owned calendars do).
      if (url.searchParams.get('debug') === 'get') {
        const nameFilter = (url.searchParams.get('calendar') || '').toLowerCase();
        const auth = basicAuthHeader(env.APPLE_ID, env.APPLE_APP_PASSWORD);
        const homeUrl = await getCalDavHomeUrl(auth);
        const calendars = await listCalendars(homeUrl, auth);
        const match = calendars.find(c => c.name.toLowerCase().includes(nameFilter));
        if (!match) {
          return new Response(JSON.stringify({ status: 'error', message: `No calendar name contains "${nameFilter}". Found: ${calendars.map(c => c.name).join(', ')}` }), {
            headers: { 'Content-Type': 'application/json', ...cors }
          });
        }
        const getRes = await fetch(match.url, { method: 'GET', headers: { Authorization: auth } });
        const getBody = await getRes.text();
        return new Response(JSON.stringify({
          status: 'success',
          calendar: match.name,
          httpStatus: getRes.status,
          contentType: getRes.headers.get('Content-Type'),
          bodyLength: getBody.length,
          bodySample: getBody.slice(0, 1500)
        }, null, 2), {
          headers: { 'Content-Type': 'application/json', ...cors }
        });
      }

      const startParam = url.searchParams.get('start');
      const endParam = url.searchParams.get('end');

      let start, end;
      if (startParam && endParam) {
        // Preferred path: the caller (the webapp, in the browser) already
        // knows the user's real local timezone and sent an exact UTC
        // instant range for "today through N days from now" in it.
        start = new Date(startParam);
        end = new Date(endParam);
      } else {
        // Fallback for a bare/manual request with no range specified -
        // this uses the Worker's own (UTC) notion of "today", which will
        // be off by however many hours the caller is behind UTC.
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        end = new Date(start);
        end.setUTCDate(end.getUTCDate() + days);
      }

      const { events, calendars } = await getUpcomingCalendarEvents(start, end, env);
      return new Response(JSON.stringify({ status: 'success', events, calendars }), {
        headers: { 'Content-Type': 'application/json', ...cors }
      });
    } catch (err) {
      return new Response(JSON.stringify({ status: 'error', message: err.message }), {
        headers: { 'Content-Type': 'application/json', ...cors }
      });
    }
  }
};
