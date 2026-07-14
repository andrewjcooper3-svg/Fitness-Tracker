/**
 * Workout Tracker - Google Apps Script Web Endpoint
 *
 * Receives POST requests from the workout tracker HTML page and logs
 * each completed exercise (pushups included, logged like any other
 * exercise) as rows in a Google Sheet. Each calendar week gets its own
 * tab, named from the Monday-Sunday date range (e.g. "Week of Jul 13 -
 * Jul 19, 2026"), so a fresh copy of the HTML tracker each week keeps
 * logging into the same spreadsheet without the tabs running together.
 *
 * Setup:
 *   1. Paste this file into a new Apps Script project (script.google.com).
 *   2. Run setup() once from the editor to create the Sheet and this
 *      week's tab.
 *   3. Deploy > New deployment > Web app > Execute as: Me, Access: Anyone.
 *   4. Copy the deployment URL into the HTML tracker's DEPLOYMENT_URL field.
 */

const HEADERS = ['Timestamp', 'Day', 'Exercise', 'Target Weight', 'Target Reps', 'Sets Completed', 'Sets Planned', 'Total Reps', 'Notes'];
const COLUMN_WIDTHS = [140, 90, 190, 100, 100, 110, 100, 100, 240];

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

  // Center the numeric columns (Target Weight through Total Reps) for the whole sheet.
  sheet.getRange(1, 4, sheet.getMaxRows(), 5).setHorizontalAlignment('center');
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

    if (exercises.length > 0) {
      exercises.forEach(function (ex) {
        appendRow([
          timestamp,
          day,
          ex.name || '',
          ex.targetWeight != null ? ex.targetWeight : '',
          ex.targetReps != null ? ex.targetReps : '',
          ex.setsCompleted != null ? ex.setsCompleted : '',
          ex.setsPlanned != null ? ex.setsPlanned : '',
          ex.totalReps != null ? ex.totalReps : '',
          ex.notes || ''
        ]);
      });
    } else {
      // No exercises for the day (e.g. a rest/cardio-only day) - log a single placeholder row.
      appendRow([timestamp, day, '', '', '', '', '', '', data.notes || '']);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', rowsAdded: Math.max(exercises.length, 1), sheet: weekLabel }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
