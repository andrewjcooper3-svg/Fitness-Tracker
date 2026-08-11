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

// Bumped on every deploy-affecting change - the client fetches the bare
// deployment URL (no action param) and compares this against its own
// expected value, so a stale deployment (redeploy skipped or missed)
// shows up as a clear warning in Settings instead of silently breaking
// whichever feature changed since the last real deploy.
const BACKEND_BUILD_VERSION = '2026-08-11-settings-sheet';

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

const WATER_SHEET_NAME = 'Water Log';
const WATER_HEADERS = ['Date', 'Type', 'Raw Ounces', 'Hydration Ounces', 'Logged At'];

/**
 * Unlike the weight log (one upserted row per day, since only the latest
 * reading matters), water intake is additive - every tap of a drink
 * button is its own row here, and the daily total is the sum of that
 * day's Hydration Ounces. Appending instead of upserting means two
 * devices tapping around the same time can never stomp on each other
 * (no read-modify-write race), and getWaterLedgerFromSheets_ below
 * always recomputes the true total straight from these rows rather than
 * trusting a client's locally-remembered running count. Raw Ounces is
 * kept alongside Hydration Ounces purely for a readable log (e.g. "11oz
 * Coffee" rather than just "8"); only Hydration Ounces feeds the ledger.
 */
function getOrCreateWaterSheet_() {
  const ss = getOrCreateSpreadsheet_();
  let sheet = ss.getSheetByName(WATER_SHEET_NAME);
  if (sheet) {
    // Re-stamp the header row if an earlier version of this sheet was
    // created with the old 3-column layout (Date, Ounces, Logged At) -
    // keeps new reads/writes self-consistent going forward without a
    // full data migration for what's still a brand new, likely-empty log.
    const existingHeaders = sheet.getRange(1, 1, 1, WATER_HEADERS.length).getValues()[0];
    if (existingHeaders.join('|') !== WATER_HEADERS.join('|')) {
      sheet.getRange(1, 1, 1, WATER_HEADERS.length).setValues([WATER_HEADERS]);
    }
    return sheet;
  }

  sheet = ss.insertSheet(WATER_SHEET_NAME);
  sheet.appendRow(WATER_HEADERS);
  const headerRange = sheet.getRange(1, 1, 1, WATER_HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1d24');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  return sheet;
}

function logWaterEntry_(date, type, rawOz, hydrationOz) {
  const sheet = getOrCreateWaterSheet_();
  sheet.appendRow([date, type || 'water', rawOz, hydrationOz, new Date()]);
}

function deleteLastWaterEntry_() {
  const sheet = getOrCreateWaterSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRow(lastRow);
}

function getWaterLedgerFromSheets_() {
  const sheet = getOrCreateWaterSheet_();
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  const ledger = {};
  if (lastRow < 2) return ledger;

  const rows = sheet.getRange(2, 1, lastRow - 1, WATER_HEADERS.length).getValues();
  rows.forEach(function (row) {
    const key = cellDateKey_(row[0], timeZone);
    const hydrationOz = Number(row[3]);
    if (isNaN(hydrationOz)) return;
    ledger[key] = (ledger[key] || 0) + hydrationOz;
  });
  return ledger;
}

// Per-entry detail (type, volume, and time of day) for one calendar day -
// the day-total ledger above only knows "how much," not "when" or "what
// kind," which the client needs for the hourly intake chart.
function getWaterEntriesForDate_(date) {
  const sheet = getOrCreateWaterSheet_();
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, WATER_HEADERS.length).getValues();
  const entries = [];
  rows.forEach(function (row) {
    if (cellDateKey_(row[0], timeZone) !== date) return;
    const hydrationOz = Number(row[3]);
    if (isNaN(hydrationOz) || !(row[4] instanceof Date)) return;
    entries.push({
      type: row[1] || 'water',
      rawOz: Number(row[2]) || hydrationOz,
      hydrationOz: hydrationOz,
      loggedAt: Utilities.formatDate(row[4], timeZone, "yyyy-MM-dd'T'HH:mm:ss")
    });
  });
  return entries;
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

  if (lastRow > 1) {
    const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (cellDateKey_(dates[i][0], timeZone) === date) {
        const rowIndex = i + 2;
        // Merge onto the existing row so a shortcut that only sends one
        // metric (e.g. just sleep) doesn't blank out what the others already saved today.
        const existing = sheet.getRange(rowIndex, 1, 1, BODY_HEALTH_HEADERS.length).getValues()[0];
        const row = [
          date,
          data.sleepHours != null ? data.sleepHours : existing[1],
          data.hrv != null ? data.hrv : existing[2],
          data.restingHR != null ? data.restingHR : existing[3],
          data.workoutMinutes != null ? data.workoutMinutes : existing[4],
          data.avgWorkoutHR != null ? data.avgWorkoutHR : existing[5],
          source || existing[6],
          now
        ];
        sheet.getRange(rowIndex, 1, 1, BODY_HEALTH_HEADERS.length).setValues([row]);
        return;
      }
    }
  }

  sheet.appendRow([
    date,
    data.sleepHours != null ? data.sleepHours : '',
    data.hrv != null ? data.hrv : '',
    data.restingHR != null ? data.restingHR : '',
    data.workoutMinutes != null ? data.workoutMinutes : '',
    data.avgWorkoutHR != null ? data.avgWorkoutHR : '',
    source || '',
    now
  ]);
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

// Kitchen (Inventory/manual Grocery items/Shopping list) is local-storage-
// only (one device, no sync) - stored the same simple way as the draft
// state above: one JSON blob in Script Properties, whole-state overwrite
// on every save, whole-state pull on load. No per-item merge/conflict
// logic - appropriate for a single person using their own devices, not
// concurrent multi-user editing.
//
// Recipes are NOT part of this blob - see "Recipe Database" below, a
// separate spreadsheet (one tab per recipe) that's the real source of
// truth, so recipes are readable/editable directly in Sheets rather than
// buried in a JSON property.
const KITCHEN_STATE_KEY = 'KITCHEN_STATE';

function saveKitchenState_(inventory, groceryManual, shoppingList) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(KITCHEN_STATE_KEY, JSON.stringify({
    inventory: inventory || [],
    groceryManual: groceryManual || [],
    shoppingList: shoppingList || [],
    savedAt: new Date().toISOString()
  }));
}

function loadKitchenState_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(KITCHEN_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// ---------- Recipe Database (its own spreadsheet, one tab per recipe) ----------
//
// Deliberately a separate spreadsheet from the workout log (a separate
// RECIPES_SHEET_ID property, same pattern as getOrCreateSpreadsheet_
// above) - the workout Sheet stays strictly workout weeks, nothing else
// gets mixed into it.
//
// Each recipe's tab layout:
//   A1: "Recipe ID"   B1: <id>            (stable key - lets a rename
//                                           update the same tab instead
//                                           of creating a duplicate)
//   A2: "Name"        B2: <name>
//   A3: "Image URL"   B3: <image>
//   A4: "Instructions" B4: <instructions>
//   Row 6: header row - Ingredient | Qty | Unit | Staple
//   Row 7+: one row per ingredient
//
// inventoryId (the app's own link from an ingredient to a specific
// inventory item) is intentionally NOT stored here - it's a local
// convenience the app already re-derives by name match on load
// (autoLinkIngredients_), so persisting it would just be a stale id
// once it's read back on a different device.
const RECIPE_SHEET_INGREDIENT_HEADER_ROW = 6;

function getOrCreateRecipesSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty('RECIPES_SHEET_ID');
  let ss;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create('Recipe Database');
    props.setProperty('RECIPES_SHEET_ID', ss.getId());
  }

  return ss;
}

// Sheet tab names can't contain : \ / ? * [ ] and max out at 100 chars -
// sanitize and leave headroom for the " (2)" de-dup suffix below.
function sanitizeRecipeSheetName_(name) {
  let clean = (name || '').replace(/[:\\\/\?\*\[\]]/g, '-').trim();
  if (!clean) clean = 'Untitled Recipe';
  return clean.slice(0, 90);
}

function findRecipeSheetById_(ss, id) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getLastRow() < 1) continue;
    if (String(sheets[i].getRange(1, 2).getValue()) === String(id)) return sheets[i];
  }
  return null;
}

// Picks a tab name that won't collide with a different recipe's tab -
// "Chili", "Chili (2)", "Chili (3)"... The recipe's own existing sheet
// (if renaming in place) doesn't count as a collision with itself.
function uniqueRecipeSheetName_(ss, name, keepSheet) {
  const base = sanitizeRecipeSheetName_(name);
  let candidate = base;
  let n = 2;
  while (true) {
    const found = ss.getSheetByName(candidate);
    if (!found || (keepSheet && found.getName() === keepSheet.getName())) return candidate;
    candidate = (base + ' (' + n + ')').slice(0, 95);
    n++;
  }
}

function saveRecipeToSheet_(recipe) {
  if (!recipe || !recipe.id) return;
  const ss = getOrCreateRecipesSpreadsheet_();
  let sheet = findRecipeSheetById_(ss, recipe.id);
  const desiredName = uniqueRecipeSheetName_(ss, recipe.name, sheet);

  if (!sheet) {
    sheet = ss.insertSheet(desiredName);
  } else if (sheet.getName() !== desiredName) {
    sheet.setName(desiredName);
  }

  sheet.clear();
  sheet.getRange(1, 1, 4, 2).setValues([
    ['Recipe ID', recipe.id],
    ['Name', recipe.name || ''],
    ['Image URL', recipe.image || ''],
    ['Instructions', recipe.instructions || '']
  ]);
  sheet.getRange(1, 1, 4, 1).setFontWeight('bold');

  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  sheet.getRange(RECIPE_SHEET_INGREDIENT_HEADER_ROW, 1, 1, 4).setValues([['Ingredient', 'Qty', 'Unit', 'Staple']]);
  sheet.getRange(RECIPE_SHEET_INGREDIENT_HEADER_ROW, 1, 1, 4).setFontWeight('bold');

  if (ingredients.length > 0) {
    const rows = ingredients.map(function (ing) {
      return [ing.name || '', ing.qty != null ? ing.qty : '', ing.unit || '', ing.notTracked ? 'Yes' : ''];
    });
    sheet.getRange(RECIPE_SHEET_INGREDIENT_HEADER_ROW + 1, 1, rows.length, 4).setValues(rows);
  }

  sheet.autoResizeColumns(1, 4);
}

// Sheets requires at least one tab - if the recipe being deleted is the
// only tab left, clear it instead of deleting it (leaves an empty
// "Untitled Recipe" placeholder rather than erroring).
function deleteRecipeSheet_(id) {
  const ss = getOrCreateRecipesSpreadsheet_();
  const sheet = findRecipeSheetById_(ss, id);
  if (!sheet) return;
  if (ss.getSheets().length > 1) ss.deleteSheet(sheet);
  else sheet.clear();
}

function loadRecipesFromSheets_() {
  const ss = getOrCreateRecipesSpreadsheet_();
  const recipes = [];

  ss.getSheets().forEach(function (sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 4) return;

    const meta = sheet.getRange(1, 1, 4, 2).getValues();
    const id = meta[0][1];
    const name = meta[1][1];
    if (!id || !name) return;

    const ingredients = [];
    if (lastRow > RECIPE_SHEET_INGREDIENT_HEADER_ROW) {
      const ingRows = sheet.getRange(RECIPE_SHEET_INGREDIENT_HEADER_ROW + 1, 1, lastRow - RECIPE_SHEET_INGREDIENT_HEADER_ROW, 4).getValues();
      ingRows.forEach(function (r) {
        if (!r[0]) return;
        ingredients.push({
          name: String(r[0]),
          inventoryId: null,
          qty: r[1] !== '' ? Number(r[1]) : null,
          unit: r[2] ? String(r[2]) : '',
          notTracked: r[3] === 'Yes'
        });
      });
    }

    recipes.push({
      id: String(id),
      name: String(name),
      image: meta[2][1] ? String(meta[2][1]) : '',
      instructions: meta[3][1] ? String(meta[3][1]) : '',
      ingredients: ingredients
    });
  });

  return recipes;
}

// Spotify connection (Client ID, OAuth tokens, pinned/workout playlists)
// was local-storage-only, so "Connect Spotify" - pasting a Client ID and
// completing the OAuth consent screen - had to be repeated on every new
// device. Same whole-blob-overwrite pattern as Kitchen above: one JSON
// blob in Script Properties, no per-field merge logic, appropriate for a
// single person's own devices.
const SPOTIFY_STATE_KEY = 'SPOTIFY_STATE';

function saveSpotifyState_(clientId, tokens, playlists) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(SPOTIFY_STATE_KEY, JSON.stringify({
    clientId: clientId || '',
    tokens: tokens || null,
    playlists: playlists || null,
    savedAt: new Date().toISOString()
  }));
}

function loadSpotifyState_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(SPOTIFY_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Third-party recipe search API keys (Spoonacular, Edamam) - same
// whole-blob sync as Spotify/Kitchen above, so pasting a key on one
// device carries over to the others instead of needing to be re-entered.
const API_KEYS_STATE_KEY = 'API_KEYS_STATE';

function saveApiKeysState_(spoonacularKey, edamamAppId, edamamAppKey) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(API_KEYS_STATE_KEY, JSON.stringify({
    spoonacularKey: spoonacularKey || '',
    edamamAppId: edamamAppId || '',
    edamamAppKey: edamamAppKey || '',
    savedAt: new Date().toISOString()
  }));
}

function loadApiKeysState_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(API_KEYS_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Pushup Goals / Body Health settings (daily baseline, year goal, max
// HR), the manual year-total correction, and the Water widget's goal +
// per-drink oz amounts - same cross-device reach as everything else in
// this file, but as a real "Settings" sheet (Key/Value, one row per
// setting) rather than an opaque PropertiesService blob, so a value can
// be eyeballed or hand-corrected directly in the spreadsheet the same
// way Weight/Water/Body Health already can. yearCarry is the one
// exception kept as a JSON string in its own cell, since it's an
// internal bookkeeping object rather than something meant to be
// hand-edited.
const SETTINGS_STATE_KEY = 'APP_SETTINGS_STATE'; // legacy PropertiesService key, read once below to migrate
const SETTINGS_SHEET_NAME = 'Settings';
const SETTINGS_HEADERS = ['Key', 'Value'];
const SETTINGS_DRINK_TYPES = ['water', 'coffee', 'tea'];

function getOrCreateSettingsSheet_() {
  const ss = getOrCreateSpreadsheet_();
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
  sheet.appendRow(SETTINGS_HEADERS);
  const headerRange = sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1d24');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 280);

  // One-time carry-forward from the PropertiesService blob this
  // replaces, so switching to a visible sheet doesn't silently drop a
  // goal or correction saved before this migration.
  const legacyRaw = PropertiesService.getScriptProperties().getProperty(SETTINGS_STATE_KEY);
  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw);
      if (legacy.dailyBaseline) sheet.appendRow(['dailyBaseline', legacy.dailyBaseline]);
      if (legacy.yearGoal) sheet.appendRow(['yearGoal', legacy.yearGoal]);
      if (legacy.maxHR) sheet.appendRow(['maxHR', legacy.maxHR]);
      if (legacy.waterGoal) sheet.appendRow(['waterGoal', legacy.waterGoal]);
      if (legacy.yearCarry) sheet.appendRow(['yearCarry', JSON.stringify(legacy.yearCarry)]);
      if (legacy.drinkAmounts) {
        SETTINGS_DRINK_TYPES.forEach(function (type) {
          const d = legacy.drinkAmounts[type];
          if (d) {
            sheet.appendRow(['drink.' + type + '.rawOz', d.rawOz]);
            sheet.appendRow(['drink.' + type + '.hydrationOz', d.hydrationOz]);
          }
        });
      }
    } catch (e) {
      // Malformed legacy blob - nothing to carry forward, sheet just starts empty.
    }
  }

  return sheet;
}

function setSettingsValue_(sheet, key, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i][0] === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sheet.appendRow([key, value]);
}

function saveSettingsState_(dailyBaseline, yearGoal, maxHR, yearCarry, waterGoal, drinkAmounts) {
  const sheet = getOrCreateSettingsSheet_();
  if (dailyBaseline) setSettingsValue_(sheet, 'dailyBaseline', dailyBaseline);
  if (yearGoal) setSettingsValue_(sheet, 'yearGoal', yearGoal);
  if (maxHR) setSettingsValue_(sheet, 'maxHR', maxHR);
  if (waterGoal) setSettingsValue_(sheet, 'waterGoal', waterGoal);
  if (yearCarry) setSettingsValue_(sheet, 'yearCarry', JSON.stringify(yearCarry));
  if (drinkAmounts) {
    SETTINGS_DRINK_TYPES.forEach(function (type) {
      const d = drinkAmounts[type];
      if (!d) return;
      if (d.rawOz != null) setSettingsValue_(sheet, 'drink.' + type + '.rawOz', d.rawOz);
      if (d.hydrationOz != null) setSettingsValue_(sheet, 'drink.' + type + '.hydrationOz', d.hydrationOz);
    });
  }
  setSettingsValue_(sheet, 'savedAt', new Date().toISOString());
}

function loadSettingsState_() {
  const sheet = getOrCreateSettingsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const map = {};
  rows.forEach(function (r) { map[r[0]] = r[1]; });

  const drinkAmounts = {};
  let hasDrinkData = false;
  SETTINGS_DRINK_TYPES.forEach(function (type) {
    const rawVal = map['drink.' + type + '.rawOz'];
    const netVal = map['drink.' + type + '.hydrationOz'];
    if (rawVal != null && netVal != null) {
      drinkAmounts[type] = { rawOz: Number(rawVal), hydrationOz: Number(netVal) };
      hasDrinkData = true;
    }
  });

  return {
    dailyBaseline: map.dailyBaseline || null,
    yearGoal: map.yearGoal || null,
    maxHR: map.maxHR || null,
    waterGoal: map.waterGoal || null,
    yearCarry: map.yearCarry ? JSON.parse(map.yearCarry) : null,
    drinkAmounts: hasDrinkData ? drinkAmounts : null
  };
}

// Overview widget board layout (sizes + order) - same whole-blob sync,
// so rearranging or resizing widgets on one device carries over to the
// others instead of staying stuck per-device.
const OVERVIEW_LAYOUT_STATE_KEY = 'OVERVIEW_LAYOUT_STATE';

function saveOverviewLayoutState_(sizes, order) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(OVERVIEW_LAYOUT_STATE_KEY, JSON.stringify({
    sizes: sizes || null,
    order: order || null,
    savedAt: new Date().toISOString()
  }));
}

function loadOverviewLayoutState_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(OVERVIEW_LAYOUT_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Derives day-by-day pushup totals directly from the already-synced
// per-set workout log (every week's own sheet, one row per set) instead
// of trusting a separate local-only running tally - so a wiped/reset
// device (cache clear, new phone, etc.) can recover real history from
// the same sheet a Session Summary already writes to, rather than that
// history only ever existing in one browser's localStorage. Keyed the
// same way the client's local ledger is: each week-sheet's own Monday
// plus the row's Day column position (Monday=0 ... Sunday=6), not the
// literal log timestamp - a session logged late at night for "Tuesday"
// still counts against the Tuesday slot even if it was typed in past
// midnight or backfilled the same day as another tab.
const PUSHUP_LEDGER_DAY_INDEX = { 'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6 };

function getPushupLedgerFromSheets_() {
  const ss = getOrCreateSpreadsheet_();
  const timeZone = ss.getSpreadsheetTimeZone();
  const ledger = {};

  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getSheetName();
    const m = name.match(/^Week of ([A-Za-z]+ \d+) - [A-Za-z]+ \d+, (\d{4})$/);
    if (!m) return; // Not a weekly workout-log sheet (Weight Log, Body Health Log, etc.)

    const monday = new Date(m[1] + ', ' + m[2]);
    if (isNaN(monday.getTime())) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    rows.forEach(function (row) {
      const day = row[1];
      const exercise = row[2];
      if (exercise !== 'Pushups') return;
      const dayIdx = PUSHUP_LEDGER_DAY_INDEX[day];
      if (dayIdx == null) return;
      const reps = Number(row[7]);
      if (isNaN(reps)) return;

      const date = new Date(monday);
      date.setDate(monday.getDate() + dayIdx);
      const key = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
      ledger[key] = (ledger[key] || 0) + reps;
    });
  });

  return ledger;
}

// For each exercise name, finds the most recent session it was actually
// logged in (any day, any week - not necessarily "last week", since the
// same lift can fall on different days across a schedule change) and
// records that session's top set: the highest actual weight logged, and
// the actual reps alongside it. Lets the client show "last time you did
// this, you did X lb x Y reps" plus whether this week's target is up or
// down from that, regardless of which day of the week it happened on.
// Sheets are processed oldest-to-newest so a later week's entry for the
// same exercise naturally overwrites an earlier one.
function getExerciseHistory_() {
  const ss = getOrCreateSpreadsheet_();
  const history = {};

  const weekSheets = [];
  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getSheetName();
    const m = name.match(/^Week of ([A-Za-z]+ \d+) - [A-Za-z]+ \d+, (\d{4})$/);
    if (!m) return;
    const monday = new Date(m[1] + ', ' + m[2]);
    if (isNaN(monday.getTime())) return;
    weekSheets.push({ sheet: sheet, monday: monday });
  });
  weekSheets.sort(function (a, b) { return a.monday - b.monday; });

  weekSheets.forEach(function (entry) {
    const sheet = entry.sheet;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    const sessions = {};
    rows.forEach(function (row) {
      const day = row[1], exercise = row[2];
      if (!exercise) return;
      const actualWeight = Number(row[5]);
      if (isNaN(actualWeight) || actualWeight <= 0) return;
      const actualReps = Number(row[7]);

      const key = day + '||' + exercise;
      const best = sessions[key];
      if (!best || actualWeight > best.weight || (actualWeight === best.weight && !isNaN(actualReps) && actualReps > best.reps)) {
        sessions[key] = { exercise: exercise, weight: actualWeight, reps: isNaN(actualReps) ? row[7] : actualReps };
      }
    });

    Object.keys(sessions).forEach(function (key) {
      const s = sessions[key];
      const nameKey = String(s.exercise).trim().toLowerCase();
      history[nameKey] = {
        weight: s.weight,
        reps: s.reps,
        asOf: Utilities.formatDate(entry.monday, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')
      };
    });
  });

  return history;
}

// Removes any existing rows for a given Day label within a single
// week-sheet before a fresh write - makes logging a day idempotent, so
// tapping "Generate Summary" mid-workout and again after finishing (or a
// manual tap followed later by the 4am auto-log, in either order) always
// leaves exactly one set of rows for that day, never a duplicate. Scans
// bottom-to-top so deleting a row doesn't shift the index of ones still
// to be checked.
function deleteRowsForDay_(sheet, day) {
  if (!day) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const dayColumn = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (let i = dayColumn.length - 1; i >= 0; i--) {
    if (dayColumn[i][0] === day) sheet.deleteRow(i + 2);
  }
}

// One row per set, replacing whatever was already logged for that day
// rather than appending alongside it (see deleteRowsForDay_ above) - so
// tapping "Generate Summary" more than once for the same day never
// leaves duplicate rows behind.
function writeSessionRows_(weekLabel, day, exercises, notes, timestamp) {
  const sheet = getOrCreateWeekSheet_(weekLabel);
  deleteRowsForDay_(sheet, day);

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
    appendRow([timestamp, day, '', '', '', '', '', '', '', notes || '']);
    rowsAdded = 1;
  }

  return rowsAdded;
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

  if (action === 'loadKitchenState') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', state: loadKitchenState_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadRecipesFromSheets') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', recipes: loadRecipesFromSheets_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadPushupLedger') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', ledger: getPushupLedgerFromSheets_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadWaterLedger') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', ledger: getWaterLedgerFromSheets_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadWaterEntries') {
    const date = e.parameter.date || Utilities.formatDate(new Date(), getOrCreateSpreadsheet_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', entries: getWaterEntriesForDate_(date) }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadSettingsState') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', state: loadSettingsState_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadOverviewLayoutState') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', state: loadOverviewLayoutState_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getExerciseHistory') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', history: getExerciseHistory_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadSpotifyState') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', state: loadSpotifyState_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'loadApiKeysState') {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success', state: loadApiKeysState_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', sheetUrl: getSheetId(), backendVersion: BACKEND_BUILD_VERSION }))
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

    if (data.action === 'logWater') {
      const hydrationOz = Number(data.hydrationOz);
      if (!data.date || isNaN(hydrationOz)) {
        throw new Error('logWater requires a date and a numeric hydrationOz');
      }
      logWaterEntry_(data.date, data.type, Number(data.rawOz) || hydrationOz, hydrationOz);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'undoLastWater') {
      deleteLastWaterEntry_();
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

    if (data.action === 'saveKitchenState') {
      saveKitchenState_(data.inventory, data.groceryManual, data.shoppingList);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'saveRecipeToSheet') {
      saveRecipeToSheet_(data.recipe);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'deleteRecipeSheet') {
      deleteRecipeSheet_(data.id);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'saveSpotifyState') {
      saveSpotifyState_(data.clientId, data.tokens, data.playlists);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'saveApiKeysState') {
      saveApiKeysState_(data.spoonacularKey, data.edamamAppId, data.edamamAppKey);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'saveSettingsState') {
      saveSettingsState_(data.dailyBaseline, data.yearGoal, data.maxHR, data.yearCarry, data.waterGoal, data.drinkAmounts);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'saveOverviewLayoutState') {
      saveOverviewLayoutState_(data.sizes, data.order);
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
    const day = data.day || '';
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const exercises = Array.isArray(data.exercises) ? data.exercises : [];
    const rowsAdded = writeSessionRows_(weekLabel, day, exercises, data.notes || '', timestamp);

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

