/**
 * Workout Tracker - Google Apps Script Web Endpoint
 *
 * Receives POST requests from the workout tracker HTML page and logs
 * one row per set (pushups included, logged like any other exercise),
 * with both the plan's target and what was actually entered, so a
 * different weight/reps on set 3 vs. set 1 isn't lost to an
 * exercise-level average. Each calendar week gets its own tab, named
 * from the Monday-Sunday date range (e.g. "Week of Jul 13 - Jul 19,
 * 2026"), so a fresh copy of the HTML tracker each week keeps logging
 * into the same spreadsheet without the tabs running together.
 *
 * Setup:
 *   1. Paste this file into a new Apps Script project (script.google.com).
 *   2. Run setup() once from the editor to create the Sheet and this
 *      week's tab.
 *   3. Deploy > New deployment > Web app > Execute as: Me, Access: Anyone.
 *   4. Copy the deployment URL into the HTML tracker's DEPLOYMENT_URL field.
 *
 * Optional - Calendar tab (reads iCloud Calendar via CalDAV):
 *   5. At appleid.apple.com, generate an app-specific password (Sign-In
 *      and Security > App-Specific Passwords).
 *   6. Fill in APPLE_ID and APPLE_APP_PASSWORD below with your real values.
 *   7. Re-deploy (Deploy > Manage deployments > edit > New version) so the
 *      live Web App picks up the code change.
 *
 * This file lives in a public repo with placeholder credentials - once you
 * fill in your real Apple ID/password, keep that copy only in the Apps
 * Script editor. Don't paste the filled-in version back into the repo.
 */

const APPLE_ID = 'YOUR_APPLE_ID@icloud.com';
const APPLE_APP_PASSWORD = 'xxxx-xxxx-xxxx-xxxx';

const HEADERS = ['Timestamp', 'Day', 'Exercise', 'Set', 'Target Weight', 'Actual Weight', 'Target Reps', 'Actual Reps', 'Completed', 'Notes'];
const COLUMN_WIDTHS = [140, 90, 190, 50, 100, 100, 90, 90, 90, 240];

// One pastel per day of week so blocks of rows are easy to tell apart at a glance.
const DAY_COLORS = {
  'Monday': '#FDEBD0',
  'Tuesday': '#FCF3CF',
  'Wednesday': '#D5F5E3',
  'Thursday': '#D6EAF8',
  'Friday': '#E8DAEF',
  'Saturday': '#D0ECE7',
  'Sunday': '#FADBD8'
};

function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('SHEET_ID');
  let ss;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create('Workout Tracker Log');
    props.setProperty('SHEET_ID', ss.getId());
  }

  return ss;
}

function formatWeekLabel_(monday, sunday) {
  const opts = { month: 'short', day: 'numeric' };
  const mondayStr = monday.toLocaleDateString('en-US', opts);
  const sundayStr = sunday.toLocaleDateString('en-US', opts);
  return `Week of ${mondayStr} - ${sundayStr}, ${sunday.getFullYear()}`;
}

/**
 * Mirrors the Monday-Sunday week calculation done client-side, used as a
 * fallback when a request doesn't include a "week" label.
 */
function getCurrentWeekLabel_() {
  const now = new Date();
  const dow = now.getDay();
  const diffToMonday = (dow === 0 ? -6 : 1) - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return formatWeekLabel_(monday, sunday);
}

function formatNewSheet_(sheet) {
  sheet.appendRow(HEADERS);
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1d24');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  COLUMN_WIDTHS.forEach(function (width, i) {
    sheet.setColumnWidth(i + 1, width);
  });

  // Center the numeric-ish columns (Set through Completed) for the whole sheet.
  sheet.getRange(1, 4, sheet.getMaxRows(), 6).setHorizontalAlignment('center');
}

function getOrCreateWeekSheet_(weekLabel) {
  const ss = getOrCreateSpreadsheet_();
  let sheet = ss.getSheetByName(weekLabel);
  if (sheet) return sheet;

  const sheets = ss.getSheets();
  if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
    sheet = sheets[0];
    sheet.setName(weekLabel);
  } else {
    sheet = ss.insertSheet(weekLabel);
  }

  formatNewSheet_(sheet);
  return sheet;
}

/**
 * Run this once manually from the Apps Script editor to create the
 * Sheet and this week's tab ahead of time, and print its URL to the
 * execution log.
 */
function setup() {
  const sheet = getOrCreateWeekSheet_(getCurrentWeekLabel_());
  Logger.log('Sheet URL: ' + sheet.getParent().getUrl());
}

/**
 * Returns the spreadsheet URL. Can be called via GET for a quick sanity
 * check that the deployment is wired to the right Sheet.
 */
function getSheetId() {
  return getOrCreateSpreadsheet_().getUrl();
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : null;

  if (action === 'calendar') {
    try {
      const days = e.parameter.days ? parseInt(e.parameter.days, 10) : 14;
      const events = getUpcomingCalendarEvents_(days);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success', events: events }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      Logger.log('calendar doGet error: ' + err);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', sheetUrl: getSheetId() }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ---------- iCloud Calendar (CalDAV, read-only) ----------
 *
 * Reads events straight from iCloud over CalDAV using an Apple ID +
 * app-specific password, stored only in this script's Script Properties
 * (Project Settings > Script Properties) - never sent to or stored by
 * the webapp itself:
 *   APPLE_ID            your Apple ID email
 *   APPLE_APP_PASSWORD  an app-specific password from appleid.apple.com
 *                        (Sign-In and Security > App-Specific Passwords)
 *
 * This is a minimal CalDAV client - enough to discover your calendars and
 * pull upcoming VEVENTs for read-only display, not a full RFC 4791/5545
 * implementation (no recurrence expansion, no write support).
 */

function getAppleCredentials_() {
  if (!APPLE_ID || !APPLE_APP_PASSWORD || APPLE_ID.indexOf('YOUR_APPLE_ID') !== -1) {
    throw new Error('Set APPLE_ID and APPLE_APP_PASSWORD near the top of this file.');
  }
  return { appleId: APPLE_ID, appPassword: APPLE_APP_PASSWORD };
}

// Issues a CalDAV request, manually following redirects (iCloud's root
// 301s to a per-account pod host) so the original method/body survives -
// letting fetch() auto-follow could silently downgrade PROPFIND/REPORT.
function caldavRequest_(url, method, body, extraHeaders) {
  const creds = getAppleCredentials_();
  const auth = Utilities.base64Encode(creds.appleId + ':' + creds.appPassword);
  const headers = Object.assign({
    'Authorization': 'Basic ' + auth,
    'Content-Type': 'application/xml; charset=utf-8'
  }, extraHeaders || {});

  const options = {
    method: method,
    headers: headers,
    payload: body || '',
    muteHttpExceptions: true,
    followRedirects: false
  };

  let response = UrlFetchApp.fetch(url, options);
  let code = response.getResponseCode();
  let redirectCount = 0;

  while ((code === 301 || code === 302 || code === 307 || code === 308) && redirectCount < 5) {
    const responseHeaders = response.getAllHeaders();
    const location = responseHeaders['Location'] || responseHeaders['location'];
    if (!location) break;
    response = UrlFetchApp.fetch(location, options);
    code = response.getResponseCode();
    redirectCount++;
  }

  return response;
}

function xmlText_(node) {
  return node ? node.getText() : '';
}

// Finds the first descendant element matching a local name, ignoring
// namespace prefixes (DAV: vs urn:ietf:params:xml:ns:caldav, etc).
function findElement_(root, localName) {
  if (!root) return null;
  if (root.getName && root.getName() === localName) return root;
  const children = root.getChildren ? root.getChildren() : [];
  for (let i = 0; i < children.length; i++) {
    const found = findElement_(children[i], localName);
    if (found) return found;
  }
  return null;
}

function findElements_(root, localName, out) {
  out = out || [];
  if (!root) return out;
  if (root.getName && root.getName() === localName) out.push(root);
  const children = root.getChildren ? root.getChildren() : [];
  children.forEach(function (c) { findElements_(c, localName, out); });
  return out;
}

function getCalDavHomeUrl_() {
  const base = 'https://caldav.icloud.com';

  const principalBody =
    '<?xml version="1.0" encoding="utf-8" ?>' +
    '<A:propfind xmlns:A="DAV:"><A:prop><A:current-user-principal/></A:prop></A:propfind>';
  const principalRes = caldavRequest_(base + '/', 'propfind', principalBody, { Depth: '0' });
  if (principalRes.getResponseCode() >= 400) {
    throw new Error('CalDAV principal lookup failed (' + principalRes.getResponseCode() + '): ' + principalRes.getContentText().slice(0, 300));
  }
  const principalXml = XmlService.parse(principalRes.getContentText()).getRootElement();
  const principalHrefEl = findElement_(principalXml, 'href');
  if (!principalHrefEl) throw new Error('Could not find current-user-principal in CalDAV response.');
  const principalPath = xmlText_(principalHrefEl);
  const principalUrl = /^https?:\/\//.test(principalPath) ? principalPath : (base + principalPath);

  const homeBody =
    '<?xml version="1.0" encoding="utf-8" ?>' +
    '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<A:prop><C:calendar-home-set/></A:prop></A:propfind>';
  const homeRes = caldavRequest_(principalUrl, 'propfind', homeBody, { Depth: '0' });
  if (homeRes.getResponseCode() >= 400) {
    throw new Error('CalDAV calendar-home-set lookup failed (' + homeRes.getResponseCode() + '): ' + homeRes.getContentText().slice(0, 300));
  }
  const homeXml = XmlService.parse(homeRes.getContentText()).getRootElement();
  const homeHrefEl = findElement_(homeXml, 'href');
  if (!homeHrefEl) throw new Error('Could not find calendar-home-set in CalDAV response.');
  const homePath = xmlText_(homeHrefEl);
  return /^https?:\/\//.test(homePath) ? homePath : (base + homePath);
}

function listCalendars_(homeUrl) {
  const body =
    '<?xml version="1.0" encoding="utf-8" ?>' +
    '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">' +
    '<A:prop><A:resourcetype/><A:displayname/></A:prop></A:propfind>';
  const res = caldavRequest_(homeUrl, 'propfind', body, { Depth: '1' });
  if (res.getResponseCode() >= 400) {
    throw new Error('CalDAV calendar listing failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  const root = XmlService.parse(res.getContentText()).getRootElement();
  const responses = findElements_(root, 'response');

  const calendars = [];
  responses.forEach(function (resp) {
    const resourcetype = findElement_(resp, 'resourcetype');
    const isCalendar = resourcetype && findElement_(resourcetype, 'calendar');
    if (!isCalendar) return;
    const hrefEl = findElement_(resp, 'href');
    const nameEl = findElement_(resp, 'displayname');
    if (!hrefEl) return;
    const href = xmlText_(hrefEl);
    calendars.push({
      url: /^https?:\/\//.test(href) ? href : ('https://caldav.icloud.com' + href),
      name: nameEl ? xmlText_(nameEl) : 'Calendar'
    });
  });
  return calendars;
}

function fetchEventsForCalendar_(calUrl, startDate, endDate) {
  const fmt = function (d) {
    return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  };
  const body =
    '<?xml version="1.0" encoding="utf-8" ?>' +
    '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    '<D:prop><D:getetag/><C:calendar-data/></D:prop>' +
    '<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">' +
    '<C:time-range start="' + fmt(startDate) + '" end="' + fmt(endDate) + '"/>' +
    '</C:comp-filter></C:comp-filter></C:filter>' +
    '</C:calendar-query>';
  const res = caldavRequest_(calUrl, 'report', body, { Depth: '1' });
  if (res.getResponseCode() >= 400) {
    throw new Error('CalDAV event query failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  const root = XmlService.parse(res.getContentText()).getRootElement();
  const dataEls = findElements_(root, 'calendar-data');
  const events = [];
  dataEls.forEach(function (el) {
    events.push.apply(events, parseICSEvents_(xmlText_(el)));
  });
  return events;
}

// Minimal VEVENT parser - handles SUMMARY, DTSTART, DTEND (date-only and
// dateTime forms). Enough for a read-only display list; not a full
// RFC 5545 implementation (no recurrence expansion, no timezone tables).
function parseICSEvents_(icsText) {
  const events = [];
  const veventBlocks = icsText.split('BEGIN:VEVENT').slice(1);
  veventBlocks.forEach(function (block) {
    const lines = block.split('END:VEVENT')[0].split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    const event = { summary: '', start: null, end: null, allDay: false };
    lines.forEach(function (line) {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const keyPart = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const key = keyPart.split(';')[0];

      if (key === 'SUMMARY') event.summary = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ');
      if (key === 'DTSTART') {
        event.allDay = keyPart.indexOf('VALUE=DATE') !== -1 && keyPart.indexOf('VALUE=DATE-TIME') === -1;
        event.start = parseICSDate_(value, event.allDay);
      }
      if (key === 'DTEND') {
        event.end = parseICSDate_(value, keyPart.indexOf('VALUE=DATE') !== -1 && keyPart.indexOf('VALUE=DATE-TIME') === -1);
      }
    });
    if (event.summary && event.start) events.push(event);
  });
  return events;
}

function parseICSDate_(value, allDay) {
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

/**
 * Returns upcoming events (default: next 14 days) across all of the
 * user's iCloud calendars, sorted chronologically. Cached briefly since
 * a full CalDAV round-trip is several requests.
 */
function getUpcomingCalendarEvents_(days) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'calendar_events_' + (days || 14);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const homeUrl = getCalDavHomeUrl_();
  const calendars = listCalendars_(homeUrl);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + (days || 14));

  const allEvents = [];
  calendars.forEach(function (cal) {
    try {
      const events = fetchEventsForCalendar_(cal.url, start, end);
      events.forEach(function (ev) { ev.calendar = cal.name; });
      allEvents.push.apply(allEvents, events);
    } catch (e) {
      Logger.log('Skipping calendar "' + cal.name + '": ' + e.message);
    }
  });

  allEvents.sort(function (a, b) { return a.start - b.start; });

  const result = allEvents.map(function (ev) {
    return {
      summary: ev.summary,
      start: ev.start.toISOString(),
      end: ev.end ? ev.end.toISOString() : null,
      allDay: ev.allDay,
      calendar: ev.calendar
    };
  });

  cache.put(cacheKey, JSON.stringify(result), 300);
  return result;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No POST data received');
    }

    const data = JSON.parse(e.postData.contents);
    const weekLabel = data.week || getCurrentWeekLabel_();
    const sheet = getOrCreateWeekSheet_(weekLabel);

    const day = data.day || '';
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const exercises = Array.isArray(data.exercises) ? data.exercises : [];
    const color = DAY_COLORS[day];

    const priorLastRow = sheet.getLastRow();
    const priorDay = priorLastRow > 1 ? sheet.getRange(priorLastRow, 2).getValue() : null;
    let isFirstRowOfBatch = true;

    function appendRow(row) {
      sheet.appendRow(row);
      const rowIndex = sheet.getLastRow();
      const range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);

      if (color) range.setBackground(color);
      if (isFirstRowOfBatch && day !== priorDay) {
        range.setBorder(true, null, null, null, null, null, '#4a4a4a', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
      }
      isFirstRowOfBatch = false;

      sheet.getRange(rowIndex, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    }

    let rowsAdded = 0;

    if (exercises.length > 0) {
      exercises.forEach(function (ex) {
        const sets = Array.isArray(ex.sets) ? ex.sets : [];
        if (sets.length > 0) {
          sets.forEach(function (s) {
            appendRow([
              timestamp,
              day,
              ex.name || '',
              s.setNum != null ? s.setNum : '',
              s.targetWeight != null ? s.targetWeight : '',
              s.actualWeight != null ? s.actualWeight : '',
              s.targetReps != null ? s.targetReps : '',
              s.actualReps != null ? s.actualReps : '',
              s.completed ? 'Yes' : 'No',
              s.notes || ''
            ]);
            rowsAdded++;
          });
        } else {
          // An exercise with no set data - log a bare placeholder row for it.
          appendRow([timestamp, day, ex.name || '', '', '', '', '', '', '', '']);
          rowsAdded++;
        }
      });
    } else {
      // No exercises for the day (e.g. a rest/cardio-only day) - log a single placeholder row.
      appendRow([timestamp, day, '', '', '', '', '', '', '', data.notes || '']);
      rowsAdded = 1;
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', rowsAdded: rowsAdded, sheet: weekLabel }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

