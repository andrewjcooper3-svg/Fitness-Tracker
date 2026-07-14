/**
 * Workout Tracker - Google Apps Script Web Endpoint
 *
 * Receives POST requests from the workout tracker HTML page and logs
 * each completed exercise (pushups included, logged like any other
 * exercise) as rows in a Google Sheet.
 *
 * Setup:
 *   1. Paste this file into a new Apps Script project (script.google.com).
 *   2. Run setup() once from the editor to create the Sheet and header row.
 *   3. Deploy > New deployment > Web app > Execute as: Me, Access: Anyone.
 *   4. Copy the deployment URL into the HTML tracker's DEPLOYMENT_URL field.
 */

const SHEET_NAME = 'Workout Log';
const HEADERS = ['Timestamp', 'Day', 'Exercise', 'Target Weight', 'Target Reps', 'Sets Completed', 'Sets Planned', 'Notes'];

function getOrCreateSheet_() {
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

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Run this once manually from the Apps Script editor to create the Sheet
 * ahead of time and print its URL to the execution log.
 */
function setup() {
  const sheet = getOrCreateSheet_();
  Logger.log('Sheet URL: ' + sheet.getParent().getUrl());
}

/**
 * Returns the Sheet URL. Can be called via GET for a quick sanity check
 * that the deployment is wired to the right Sheet.
 */
function getSheetId() {
  const sheet = getOrCreateSheet_();
  return sheet.getParent().getUrl();
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
    const sheet = getOrCreateSheet_();

    const day = data.day || '';
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const exercises = Array.isArray(data.exercises) ? data.exercises : [];

    if (exercises.length > 0) {
      exercises.forEach(function (ex) {
        sheet.appendRow([
          timestamp,
          day,
          ex.name || '',
          ex.targetWeight != null ? ex.targetWeight : '',
          ex.targetReps != null ? ex.targetReps : '',
          ex.setsCompleted != null ? ex.setsCompleted : '',
          ex.setsPlanned != null ? ex.setsPlanned : '',
          ex.notes || ''
        ]);
      });
    } else {
      // No exercises for the day (e.g. a rest/cardio-only day) - log a single placeholder row.
      sheet.appendRow([timestamp, day, '', '', '', '', '', data.notes || '']);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', rowsAdded: Math.max(exercises.length, 1) }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
