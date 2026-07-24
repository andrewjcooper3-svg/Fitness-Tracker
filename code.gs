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
 * Note: the Calendar tab (iCloud via CalDAV) is served by a separate
 * Cloudflare Worker (calendar-worker.js in this repo), not by this file -
 * Apps Script's UrlFetchApp can't issue the PROPFIND/REPORT requests CalDAV
 * requires.
 */

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

const WEIGHT_SHEET_NAME = 'Weight Log';
const WEIGHT_HEADERS = ['Date', 'Weight (lb)', 'Body Fat %', 'Source', 'Logged At'];

/**
 * One persistent sheet (not split by week, unlike the workout log) since
 * weigh-ins are one row a day at most and the whole point is a long-running
 * trend line - splitting it weekly would just make the Stats/Weight tabs
 * stitch it back together across dozens of tabs for no benefit.
 */
function getOrCreateWeightSheet_() {
  const ss = getOrCreateSpreadsheet_();
  let sheet = ss.getSheetByName(WEIGHT_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(WEIGHT_SHEET_NAME);
  sheet.appendRow(WEIGHT_HEADERS);
  const headerRange = sheet.getRange(1, 1, 1, WEIGHT_HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1d24');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Upserts by date (one row per calendar day) so a Shortcut that runs more
 * than once on the same day - or a manual entry made after an automated
 * one already logged today - overwrites instead of piling up duplicate rows.
 */
// Sheets auto-converts a plain "yyyy-MM-dd" string written into a cell into
// a real Date value, so both the upsert match below and the read-back in
// getWeightLog_ have to re-format any Date cell through the spreadsheet's
// own timezone rather than comparing/returning it raw - otherwise the
// upsert never matches an existing row (silently piling up duplicates)
// and reads can drift a day depending on the timezone the values pick up.
function cellDateKey_(rawValue, timeZone) {
  return rawValue instanceof Date ? Utilities.formatDate(rawValue, timeZone, 'yyyy-MM-dd') : String(rawValue);
}

function logWeightEntry_(date, weight, bodyFat, source) {
  const sheet = getOrCreateWeightSheet_();
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  const now = new Date();

  if (lastRow > 1) {
    const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (cellDateKey_(dates[i][0], timeZone) === date) {
        const rowIndex = i + 2;
        sheet.getRange(rowIndex, 1, 1, WEIGHT_HEADERS.length)
          .setValues([[date, weight, bodyFat != null ? bodyFat : '', source || '', now]]);
        return;
      }
    }
  }

  sheet.appendRow([date, weight, bodyFat != null ? bodyFat : '', source || '', now]);
}

function getWeightLog_() {
  const sheet = getOrCreateWeightSheet_();
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, WEIGHT_HEADERS.length).getValues();
  return rows.map(function (r) {
    return {
      date: cellDateKey_(r[0], timeZone),
      weight: r[1],
      bodyFat: r[2] === '' ? null : r[2],
      source: r[3] || ''
    };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

const BODY_HEALTH_SHEET_NAME = 'Body Health Log';
const BODY_HEALTH_HEADERS = ['Date', 'Sleep Hours', 'HRV (ms)', 'Resting HR (bpm)', 'Workout Minutes', 'Avg Workout HR', 'Source', 'Logged At'];

/**
 * Same one-row-per-day pattern as the Weight Log. An hourly Shortcut just
 * re-sends the day's up-to-date totals each run (sleep/HRV/RHR are set
 * once overnight and stay static; workout minutes/avg HR accumulate as
 * the day goes on) - the upsert-by-date below overwrites with whatever's
 * most current rather than piling up duplicate rows per hour.
 */
function getOrCreateBodyHealthSheet_() {
  const ss = getOrCreateSpreadsheet_();
  let sheet = ss.getSheetByName(BODY_HEALTH_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(BODY_HEALTH_SHEET_NAME);
  sheet.appendRow(BODY_HEALTH_HEADERS);
  const headerRange = sheet.getRange(1, 1, 1, BODY_HEALTH_HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1d24');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  return sheet;
}

function logBodyHealthEntry_(date, data, source) {
  const sheet = getOrCreateBodyHealthSheet_();
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  const now = new Date();
  const row = [
    date,
    data.sleepHours != null ? data.sleepHours : '',
    data.hrv != null ? data.hrv : '',
    data.restingHR != null ? data.restingHR : '',
    data.workoutMinutes != null ? data.workoutMinutes : '',
    data.avgWorkoutHR != null ? data.avgWorkoutHR : '',
    source || '',
    now
  ];

  if (lastRow > 1) {
    const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (cellDateKey_(dates[i][0], timeZone) === date) {
        const rowIndex = i + 2;
        sheet.getRange(rowIndex, 1, 1, BODY_HEALTH_HEADERS.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

function getBodyHealthLog_() {
  const sheet = getOrCreateBodyHealthSheet_();
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, BODY_HEALTH_HEADERS.length).getValues();
  return rows.map(function (r) {
    return {
      date: cellDateKey_(r[0], timeZone),
      sleepHours: r[1] === '' ? null : r[1],
      hrv: r[2] === '' ? null : r[2],
      restingHR: r[3] === '' ? null : r[3],
      workoutMinutes: r[4] === '' ? null : r[4],
      avgWorkoutHR: r[5] === '' ? null : r[5],
      source: r[6] || ''
    };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
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

// The draft is the same {week, days} blob the webapp already keeps in its
// own localStorage - stored here too (one slot, since it always resets
// weekly the same way locally) so opening the tracker on a different
// device picks up whatever was typed/checked on the last one, even
// before a day's "Generate Summary" actually logs anything to the Sheet.
const DRAFT_STATE_KEY = 'DRAFT_STATE';

function saveDraftState_(week, days) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(DRAFT_STATE_KEY, JSON.stringify({ week: week, days: days, savedAt: new Date().toISOString() }));
}

function loadDraftState_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(DRAFT_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : null;

  if (action === 'loadDraft') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', draft: loadDraftState_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadWeightLog') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', entries: getWeightLog_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadBodyHealthLog') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', entries: getBodyHealthLog_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', sheetUrl: getSheetId() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No POST data received');
    }

    const data = JSON.parse(e.postData.contents);

    if (data.action === 'saveDraft') {
      saveDraftState_(data.week || getCurrentWeekLabel_(), data.days || {});
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'logWeight') {
      // Coerce rather than strictly require a JS number - a hand-built
      // Shortcut whose JSON field wasn't explicitly set to "Number" type
      // sends the weight as a quoted string (e.g. "182.5"), which is
      // otherwise indistinguishable from a real client error.
      const weight = Number(data.weight);
      const bodyFat = data.bodyFat != null && data.bodyFat !== '' ? Number(data.bodyFat) : null;
      if (!data.date || isNaN(weight)) {
        throw new Error('logWeight requires a date and a numeric weight');
      }
      logWeightEntry_(data.date, weight, bodyFat != null && !isNaN(bodyFat) ? bodyFat : null, data.source || 'shortcut');
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'logBodyHealth') {
      if (!data.date) {
        throw new Error('logBodyHealth requires a date');
      }
      const toNumOrNull = v => (v != null && v !== '' && !isNaN(Number(v))) ? Number(v) : null;
      logBodyHealthEntry_(data.date, {
        sleepHours: toNumOrNull(data.sleepHours),
        hrv: toNumOrNull(data.hrv),
        restingHR: toNumOrNull(data.restingHR),
        workoutMinutes: toNumOrNull(data.workoutMinutes),
        avgWorkoutHR: toNumOrNull(data.avgWorkoutHR)
      }, data.source || 'shortcut');
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

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

