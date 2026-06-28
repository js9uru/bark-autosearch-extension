/**
 * ThatsThem name search pages — email and/or phone pattern matching (e.g. /name/Kristen-Johnson/Cheshire-CT).
 */
(function () {
  const DEFAULT_AUTO_SEARCH_INTERVAL_MINUTES = 2;
  const DEFAULT_SHEETS_TOP_N = 150;
  let autoSearchIntervalMinutes = DEFAULT_AUTO_SEARCH_INTERVAL_MINUTES;

  function parseAutoSearchIntervalMinutes(raw) {
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_AUTO_SEARCH_INTERVAL_MINUTES;
    return Math.min(120, Math.max(1, n));
  }

  function applyAutoSearchIntervalMinutes(n) {
    autoSearchIntervalMinutes = parseAutoSearchIntervalMinutes(n);
    return autoSearchIntervalMinutes;
  }

  function getAutoSearchIntervalMs() {
    return autoSearchIntervalMinutes * 60 * 1000;
  }

  function autoSearchIntervalLabel() {
    const m = autoSearchIntervalMinutes;
    return m === 1 ? "1 minute" : m + " minutes";
  }
  const SHEETS_CONFIG = {
    spreadsheetId: "1NrE9HZ9LjNg2SxSCEwO1bFr35ADn9F0oq1fP2dD3Xsk",
    sheetTab: "Bark_Leads",
    topN: DEFAULT_SHEETS_TOP_N,
    statusColName: "Status",
    todoValue: "Todo",
    inProgressValue: "In progress",
    foundValue: "Found",
    notFoundValue: "No found",
    nameColName: "Name",
    locationColName: "Location",
    phoneColName: "Phone",
    emailColName: "Email",
    serviceColName: "Service",
    verifiedPhoneColName: "Verified Phone",
    detailsColName: "Details Q&A",
    contactsTab: "Bark_Contacts",
    statisticsTab: "Bark_Statistics",
    sentColName: "Sent",
  };

  const CONTACTS_HEADER = [
    "Name",
    "Service",
    "Location",
    "Phone",
    "Email",
    "Verified Phone",
    "Details Q&A",
    "Added At",
    "Sent",
  ];

  const CONTACTS_RETENTION_DAYS = 30;
  const LAST_CONTACTS_PRUNE_DATE_KEY = "lastContactsPruneDateKey";

  const DEFAULT_MAIL_RELAY_URL = "http://13.237.55.109:8765/send";
  const DEFAULT_EMAIL_MODEL = "gemini-3.1-flash-lite";
  const OUTREACH_COMPANY = "Pinnacle Engineering, Inc.";
  const OUTREACH_SENDER = "Thomas Vadnais";

  function firstToken(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    return t.split(/\s+/)[0] || "";
  }

  /** First name from picked Bark row for "Hi …," — empty if value does not look like a person name. */
  function greetingFirstNameFromBarkRow(barkName) {
    const first = firstToken(barkName);
    if (!first) return "";
    const lower = first.toLowerCase();
    const blocked = {
      na: 1,
      "n/a": 1,
      unknown: 1,
      none: 1,
      test: 1,
      todo: 1,
      client: 1,
      customer: 1,
      homeowner: 1,
      owner: 1,
      remote: 1,
      online: 1,
    };
    if (blocked[lower]) return "";
    if (/\d/.test(first)) return "";
    if (first.length < 2 || first.length > 24) return "";
    if (!/^[A-Za-z][A-Za-z'.-]*$/.test(first)) return "";
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  function applyEmailGreeting(body, greetingFirstName) {
    const lines = String(body || "").split("\n");
    if (!lines.length) return String(body || "");
    const name = String(greetingFirstName || "").trim();
    lines[0] = name ? "Hi " + name + "," : "Hi,";
    return lines.join("\n");
  }

  /** One send per unique address; sheetRows lists every Bark_Contacts row that had that email. */
  function collectUniqueEmailSendBatches(sendPlans) {
    const byNorm = new Map();
    for (let i = 0; i < sendPlans.length; i++) {
      const plan = sendPlans[i];
      const sheetRow = plan.sheetRow;
      const list = plan.emails || [];
      for (let j = 0; j < list.length; j++) {
        const raw = String(list[j] || "").trim();
        if (!raw) continue;
        const norm = raw.toLowerCase();
        let entry = byNorm.get(norm);
        if (!entry) {
          entry = { email: raw, sheetRows: new Set() };
          byNorm.set(norm, entry);
        }
        entry.sheetRows.add(sheetRow);
      }
    }
    const out = [];
    byNorm.forEach(function (entry) {
      out.push({ email: entry.email, sheetRows: entry.sheetRows });
    });
    return out;
  }

  function areaCodePrefix(phoneValue) {
    const digits = String(phoneValue || "").replace(/\D/g, "");
    return digits.length >= 3 ? digits.slice(0, 3) + "-" : "";
  }

  function normalizeLocationCityStateZip(locationValue) {
    const raw = String(locationValue || "").trim();
    if (!raw) return { city: "", st: "", zip: "", display: "" };
    const cleaned = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();

    const STATE_TO_ABBREV = {
      alabama: "AL",
      alaska: "AK",
      arizona: "AZ",
      arkansas: "AR",
      california: "CA",
      colorado: "CO",
      connecticut: "CT",
      delaware: "DE",
      florida: "FL",
      georgia: "GA",
      hawaii: "HI",
      idaho: "ID",
      illinois: "IL",
      indiana: "IN",
      iowa: "IA",
      kansas: "KS",
      kentucky: "KY",
      louisiana: "LA",
      maine: "ME",
      maryland: "MD",
      massachusetts: "MA",
      michigan: "MI",
      minnesota: "MN",
      mississippi: "MS",
      missouri: "MO",
      montana: "MT",
      nebraska: "NE",
      nevada: "NV",
      "new hampshire": "NH",
      "new jersey": "NJ",
      "new mexico": "NM",
      "new york": "NY",
      "north carolina": "NC",
      "north dakota": "ND",
      ohio: "OH",
      oklahoma: "OK",
      oregon: "OR",
      pennsylvania: "PA",
      "rhode island": "RI",
      "south carolina": "SC",
      "south dakota": "SD",
      tennessee: "TN",
      texas: "TX",
      utah: "UT",
      vermont: "VT",
      virginia: "VA",
      washington: "WA",
      "west virginia": "WV",
      wisconsin: "WI",
      wyoming: "WY",
      "district of columbia": "DC",
    };

    const stateToAbbrev = (s) => {
      const t = String(s || "").trim();
      if (!t) return "";
      if (/^[A-Z]{2}$/.test(t)) return t;
      const k = t.toLowerCase();
      return STATE_TO_ABBREV[k] || "";
    };

    // Format: City, ST, ZIP
    let m = cleaned.match(/^\s*([^,]+?)\s*,\s*([A-Z]{2})\s*,?\s*(\d{5}(?:-\d{4})?)\b/);
    if (m) {
      const city = (m[1] || "").trim();
      const st = (m[2] || "").trim();
      const zip = (m[3] || "").trim();
      return { city, st, zip, display: `${city}, ${st}, ${zip}` };
    }

    // Format: City, StateName, ZIP (rare but support it)
    m = cleaned.match(/^\s*([^,]+?)\s*,\s*([A-Za-z ]+?)\s*,?\s*(\d{5}(?:-\d{4})?)\b/);
    if (m) {
      const city = (m[1] || "").trim();
      const st = stateToAbbrev(m[2]);
      const zip = (m[3] || "").trim();
      const display = st ? `${city}, ${st}, ${zip}` : `${city}, ${m[2].trim()}, ${zip}`;
      return { city, st: st || "", zip, display };
    }

    // Format: City, ST
    m = cleaned.match(/^\s*([^,]+?)\s*,\s*([A-Z]{2})\s*$/);
    if (m) {
      const city = (m[1] || "").trim();
      const st = (m[2] || "").trim();
      return { city, st, zip: "", display: `${city}, ${st}` };
    }

    // Format: City, StateName
    m = cleaned.match(/^\s*([^,]+?)\s*,\s*([A-Za-z ]+?)\s*$/);
    if (m) {
      const city = (m[1] || "").trim();
      const st = stateToAbbrev(m[2]);
      const display = st ? `${city}, ${st}` : cleaned;
      return { city, st: st || "", zip: "", display };
    }

    return { city: "", st: "", zip: "", display: cleaned };
  }

  async function loadServiceAccountJson() {
    const url = chrome.runtime.getURL("service_account.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Missing service_account.json in extension folder");
    return await res.json();
  }

  function base64UrlEncode(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function pemToArrayBuffer(pem) {
    const b64 = String(pem || "")
      .replace(/-----BEGIN [^-]+-----/g, "")
      .replace(/-----END [^-]+-----/g, "")
      .replace(/\s+/g, "");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function signJwtRs256(privateKeyPem, header, payload) {
    const enc = new TextEncoder();
    const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
    const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
    const data = enc.encode(headerB64 + "." + payloadB64);

    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data);
    const sigB64 = base64UrlEncode(sig);
    return headerB64 + "." + payloadB64 + "." + sigB64;
  }

  async function getServiceAccountAccessToken(sa) {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwtRs256(
      sa.private_key,
      { alg: "RS256", typ: "JWT" },
      {
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 60 * 50,
      }
    );

    const body = new URLSearchParams();
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", jwt);

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error("Failed to get Sheets access token");
    const data = await res.json();
    return data.access_token;
  }

  function a1QuoteSheetTitle(title) {
    const t = String(title || "");
    return "'" + t.replace(/'/g, "''") + "'";
  }

  async function sheetsValuesGet(token, rangeA1) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(SHEETS_CONFIG.spreadsheetId) +
      "/values/" +
      encodeURIComponent(rangeA1);
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error("Sheets read failed: " + res.status);
    return await res.json();
  }

  async function sheetsValuesUpdate(token, rangeA1, values) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(SHEETS_CONFIG.spreadsheetId) +
      "/values/" +
      encodeURIComponent(rangeA1) +
      "?valueInputOption=USER_ENTERED";
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error("Sheets update failed: " + res.status);
    return await res.json();
  }

  async function sheetsValuesClear(token, rangeA1) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(SHEETS_CONFIG.spreadsheetId) +
      "/values/" +
      encodeURIComponent(rangeA1) +
      ":clear";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) throw new Error("Sheets clear failed: " + res.status);
    return await res.json();
  }

  async function sheetsSpreadsheetGet(token) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(SHEETS_CONFIG.spreadsheetId) +
      "?fields=sheets(properties(sheetId,title))";
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("Sheets metadata failed: " + res.status);
    return await res.json();
  }

  async function sheetsBatchUpdate(token, requests) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(SHEETS_CONFIG.spreadsheetId) +
      ":batchUpdate";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests: requests || [] }),
    });
    if (!res.ok) throw new Error("Sheets batchUpdate failed: " + res.status);
    return await res.json();
  }

  function parseAddedAtToDateKey(cell) {
    const s = String(cell || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (m) {
      const mo = String(m[1]).padStart(2, "0");
      const da = String(m[2]).padStart(2, "0");
      return m[3] + "-" + mo + "-" + da;
    }
    return null;
  }

  function todayDateKeyUtc9() {
    const utc9 = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      utc9.getUTCFullYear() +
      "-" +
      pad(utc9.getUTCMonth() + 1) +
      "-" +
      pad(utc9.getUTCDate())
    );
  }

  function addedAtCutoffDateKey(retentionDays) {
    const days = typeof retentionDays === "number" ? retentionDays : CONTACTS_RETENTION_DAYS;
    const utc9 = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const cutoff = new Date(
      Date.UTC(utc9.getUTCFullYear(), utc9.getUTCMonth(), utc9.getUTCDate())
    );
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      cutoff.getUTCFullYear() +
      "-" +
      pad(cutoff.getUTCMonth() + 1) +
      "-" +
      pad(cutoff.getUTCDate())
    );
  }

  function isAddedAtOlderThanRetention(cell, retentionDays) {
    const key = parseAddedAtToDateKey(cell);
    if (!key) return false;
    return key < addedAtCutoffDateKey(retentionDays);
  }

  async function pruneOldContactRows(token, contactsSheetId, retentionDays) {
    const range = a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab) + "!H2:H10000";
    let values = [];
    try {
      const data = await sheetsValuesGet(token, range);
      values = (data && data.values) || [];
    } catch (e) {
      console.warn("Bark_Contacts: could not read Added At for pruning", e);
      return 0;
    }

    const toDelete = [];
    for (let i = 0; i < values.length; i++) {
      const cell = values[i] && values[i][0] != null ? values[i][0] : "";
      if (isAddedAtOlderThanRetention(cell, retentionDays)) {
        toDelete.push(i + 1); // 0-based sheet row index (row 2 -> 1)
      }
    }
    if (!toDelete.length) return 0;

    const requests = toDelete
      .sort(function (a, b) {
        return b - a;
      })
      .map(function (idx) {
        return {
          deleteDimension: {
            range: {
              sheetId: contactsSheetId,
              dimension: "ROWS",
              startIndex: idx,
              endIndex: idx + 1,
            },
          },
        };
      });

    try {
      await sheetsBatchUpdate(token, requests);
      console.log(
        "Pruned " +
          toDelete.length +
          " row(s) from " +
          SHEETS_CONFIG.contactsTab +
          " (older than " +
          (typeof retentionDays === "number" ? retentionDays : CONTACTS_RETENTION_DAYS) +
          " days)."
      );
    } catch (e) {
      console.warn("Bark_Contacts: prune failed", e);
      return 0;
    }
    return toDelete.length;
  }

  async function maybePruneOldContactsOncePerDay(token, contactsSheetId) {
    const today = todayDateKeyUtc9();
    const o = await storageGet([LAST_CONTACTS_PRUNE_DATE_KEY]);
    if (o[LAST_CONTACTS_PRUNE_DATE_KEY] === today) return 0;
    const n = await pruneOldContactRows(token, contactsSheetId, CONTACTS_RETENTION_DAYS);
    await storageSet({ [LAST_CONTACTS_PRUNE_DATE_KEY]: today });
    return n;
  }

  function countDatesFromColumnValues(values) {
    const counts = {};
    const rows = values || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const key = parseAddedAtToDateKey(row[0]);
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function dateKeyToMDYYYY(key) {
    const parts = String(key || "").split("-");
    if (parts.length !== 3) return key;
    return String(parseInt(parts[1], 10)) + "/" + String(parseInt(parts[2], 10)) + "/" + parts[0];
  }

  async function ensureStatisticsSheet(token) {
    const meta = await sheetsSpreadsheetGet(token);
    const list = (meta && meta.sheets) || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i] && list[i].properties ? list[i].properties : {};
      if (p.title === SHEETS_CONFIG.statisticsTab) return { sheetId: p.sheetId, created: false };
    }
    await sheetsBatchUpdate(token, [
      { addSheet: { properties: { title: SHEETS_CONFIG.statisticsTab } } },
    ]);
    return { created: true };
  }

  async function refreshBarkStatistics(token) {
    const leadsRange = a1QuoteSheetTitle(SHEETS_CONFIG.sheetTab) + "!H2:H10000";
    const contactsRange = a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab) + "!H2:H10000";
    let leadsValues = [];
    let contactsValues = [];
    try {
      const lr = await sheetsValuesGet(token, leadsRange);
      leadsValues = lr.values || [];
    } catch (e) {
      console.warn("Bark_Statistics: could not read Bark_Leads column H", e);
    }
    try {
      const cr = await sheetsValuesGet(token, contactsRange);
      contactsValues = cr.values || [];
    } catch (e) {
      console.warn("Bark_Statistics: could not read Bark_Contacts column H", e);
    }
    const leadCounts = countDatesFromColumnValues(leadsValues);
    const contactCounts = countDatesFromColumnValues(contactsValues);
    const allKeys = new Set([].concat(Object.keys(leadCounts), Object.keys(contactCounts)));
    const sorted = Array.from(allKeys).sort().reverse();
    const out = [["Date", "Leads", "Founds", "Percent"]];
    for (let i = 0; i < sorted.length; i++) {
      const dk = sorted[i];
      const lc = leadCounts[dk] || 0;
      const fc = contactCounts[dk] || 0;
      const pct = lc > 0 ? (100 * fc) / lc : 0;
      out.push([dateKeyToMDYYYY(dk), lc, fc, pct.toFixed(2) + "%"]);
    }
    await ensureStatisticsSheet(token);
    const statQuoted = a1QuoteSheetTitle(SHEETS_CONFIG.statisticsTab);
    try {
      await sheetsValuesClear(token, statQuoted + "!A1:D5000");
    } catch (e) {
      console.warn("Bark_Statistics: clear", e);
    }
    await sheetsValuesUpdate(token, statQuoted + "!A1", out);
  }

  function colNumToA1(n) {
    let x = n;
    let s = "";
    while (x > 0) {
      const r = (x - 1) % 26;
      s = String.fromCharCode("A".charCodeAt(0) + r) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  }

  async function pickFirstTodoAndMarkInProgress() {
    const sa = await loadServiceAccountJson();
    const token = await getServiceAccountAccessToken(sa);

    const maxRow = SHEETS_CONFIG.topN + 1;
    const range =
      a1QuoteSheetTitle(SHEETS_CONFIG.sheetTab) + "!A1:Z" + String(maxRow);
    const data = await sheetsValuesGet(token, range);
    const values = data.values || [];
    if (!values.length) return { picked: false, reason: "Sheet is empty" };

    const header = (values[0] || []).map((h) => String(h || "").trim());
    const statusIdx = header.indexOf(SHEETS_CONFIG.statusColName);
    if (statusIdx < 0) return { picked: false, reason: "Missing Status column" };

    const nameIdx = header.indexOf(SHEETS_CONFIG.nameColName);
    const locationIdx = header.indexOf(SHEETS_CONFIG.locationColName);
    const phoneIdx = header.indexOf(SHEETS_CONFIG.phoneColName);
    const emailIdx = header.indexOf(SHEETS_CONFIG.emailColName);
    const serviceIdx = header.indexOf(SHEETS_CONFIG.serviceColName);
    const verifiedIdx = header.indexOf(SHEETS_CONFIG.verifiedPhoneColName);
    const detailsIdx = header.indexOf(SHEETS_CONFIG.detailsColName);

    let pickedRowNumber = null;
    let pickedRow = null;
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const status = statusIdx < row.length ? String(row[statusIdx] || "").trim() : "";
      if (status.toLowerCase() === SHEETS_CONFIG.todoValue.toLowerCase()) {
        pickedRowNumber = i + 1; // because values[0] is row 1 header
        pickedRow = row;
        break;
      }
    }

    if (!pickedRowNumber) return { picked: false, reason: "No Todo rows in top " + SHEETS_CONFIG.topN };

    const colA1 = colNumToA1(statusIdx + 1);
    const cellRange = a1QuoteSheetTitle(SHEETS_CONFIG.sheetTab) + "!" + colA1 + String(pickedRowNumber);
    await sheetsValuesUpdate(token, cellRange, [[SHEETS_CONFIG.inProgressValue]]);
    const rec = {
      name: nameIdx >= 0 && pickedRow && nameIdx < pickedRow.length ? String(pickedRow[nameIdx] || "").trim() : "",
      location:
        locationIdx >= 0 && pickedRow && locationIdx < pickedRow.length ? String(pickedRow[locationIdx] || "").trim() : "",
      phone: phoneIdx >= 0 && pickedRow && phoneIdx < pickedRow.length ? String(pickedRow[phoneIdx] || "").trim() : "",
      email: emailIdx >= 0 && pickedRow && emailIdx < pickedRow.length ? String(pickedRow[emailIdx] || "").trim() : "",
      service: serviceIdx >= 0 && pickedRow && serviceIdx < pickedRow.length ? String(pickedRow[serviceIdx] || "").trim() : "",
      verifiedPhone:
        verifiedIdx >= 0 && pickedRow && verifiedIdx < pickedRow.length ? String(pickedRow[verifiedIdx] || "").trim() : "",
      details:
        detailsIdx >= 0 && pickedRow && detailsIdx < pickedRow.length ? String(pickedRow[detailsIdx] || "").trim() : "",
    };
    return { picked: true, row: pickedRowNumber, range: cellRange, record: rec };
  }

  /** Scan enough rows to find the lead we marked In progress after top inserts may have shifted row numbers. */
  async function findStatusCellRangeForInProgressLead(token, rec) {
    const maxRow = Math.max(500, SHEETS_CONFIG.topN + 50);
    const range =
      a1QuoteSheetTitle(SHEETS_CONFIG.sheetTab) + "!A1:Z" + String(maxRow);
    const data = await sheetsValuesGet(token, range);
    const values = data.values || [];
    if (!values.length) return null;

    const header = (values[0] || []).map((h) => String(h || "").trim());
    const statusIdx = header.indexOf(SHEETS_CONFIG.statusColName);
    if (statusIdx < 0) return null;

    const nameIdx = header.indexOf(SHEETS_CONFIG.nameColName);
    const locationIdx = header.indexOf(SHEETS_CONFIG.locationColName);
    const phoneIdx = header.indexOf(SHEETS_CONFIG.phoneColName);
    const emailIdx = header.indexOf(SHEETS_CONFIG.emailColName);

    const wantStatus = SHEETS_CONFIG.inProgressValue.toLowerCase();
    const rn = (s) => String(s || "").trim();
    const rowMatchesRecord = (row) => {
      const g = (idx) => (idx >= 0 && idx < row.length ? rn(row[idx]) : "");
      if (nameIdx >= 0 && g(nameIdx) !== rn(rec.name)) return false;
      if (locationIdx >= 0 && g(locationIdx) !== rn(rec.location)) return false;
      if (phoneIdx >= 0 && g(phoneIdx) !== rn(rec.phone)) return false;
      if (emailIdx >= 0 && g(emailIdx) !== rn(rec.email)) return false;
      return true;
    };

    const sheetQuoted = a1QuoteSheetTitle(SHEETS_CONFIG.sheetTab);
    const statusCol = colNumToA1(statusIdx + 1);

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const st = statusIdx < row.length ? rn(row[statusIdx]).toLowerCase() : "";
      if (st !== wantStatus) continue;
      if (!rowMatchesRecord(row)) continue;
      const sheetRowNum = i + 1;
      return {
        range: sheetQuoted + "!" + statusCol + String(sheetRowNum),
        rowNumber: sheetRowNum,
      };
    }
    return null;
  }

  /** Same format as bark_monitor_gspread.py: UTC+9 (`%Y-%m-%d %H:%M UTC+9`). */
  function addedAtString() {
    const pad = (n) => String(n).padStart(2, "0");
    const utc9 = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const yyyy = utc9.getUTCFullYear();
    const mm = pad(utc9.getUTCMonth() + 1);
    const dd = pad(utc9.getUTCDate());
    const hh = pad(utc9.getUTCHours());
    const mi = pad(utc9.getUTCMinutes());
    return yyyy + "-" + mm + "-" + dd + " " + hh + ":" + mi + " UTC+9";
  }

  function extractAllEmails(emails) {
    const arr = Array.isArray(emails) ? emails : [];
    const out = [];
    const seen = new Set();

    function addEmail(raw) {
      const v = String(raw || "").trim();
      if (!v || v.indexOf("@") < 0) return;
      const k = v.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(v);
    }

    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      if (typeof x === "string") {
        const parts = x.split(/[\n,;]+/);
        for (let j = 0; j < parts.length; j++) addEmail(parts[j]);
      } else if (x && typeof x === "object" && x.redacted === true && x.hrefEmail) {
        addEmail(x.hrefEmail);
      }
    }
    return out;
  }

  function extractAllPhones(phones) {
    const arr = Array.isArray(phones) ? phones : [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      let v = "";
      if (typeof x === "string") v = x.trim();
      else if (x && typeof x === "object" && x.redacted === true && x.hrefPhone) v = String(x.hrefPhone).trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  async function ensureContactsSheet(token) {
    const meta = await sheetsSpreadsheetGet(token);
    const list = (meta && meta.sheets) || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i] && list[i].properties ? list[i].properties : {};
      if (p.title === SHEETS_CONFIG.contactsTab) return { sheetId: p.sheetId, created: false };
    }

    const addResp = await sheetsBatchUpdate(token, [
      { addSheet: { properties: { title: SHEETS_CONFIG.contactsTab } } },
    ]);
    const sheetId =
      addResp &&
      addResp.replies &&
      addResp.replies[0] &&
      addResp.replies[0].addSheet &&
      addResp.replies[0].addSheet.properties &&
      addResp.replies[0].addSheet.properties.sheetId;

    await sheetsValuesUpdate(token, a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab) + "!A1", [CONTACTS_HEADER.slice()]);
    return { sheetId: sheetId, created: true };
  }

  async function ensureContactsSentHeader(token) {
    const tab = a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab);
    const data = await sheetsValuesGet(token, tab + "!1:1");
    const row = (data.values && data.values[0]) || [];
    const header = row.map((h) => String(h || "").trim());
    if (header.indexOf(SHEETS_CONFIG.sentColName) >= 0) return;
    const next = header.length ? header.concat([SHEETS_CONFIG.sentColName]) : CONTACTS_HEADER.slice();
    const endCol = colNumToA1(next.length);
    await sheetsValuesUpdate(token, tab + "!A1:" + endCol + "1", [next]);
  }

  async function getContactsHeaderIndex(token, colName) {
    const tab = a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab);
    const data = await sheetsValuesGet(token, tab + "!1:1");
    const row = (data.values && data.values[0]) || [];
    const header = row.map((h) => String(h || "").trim());
    return header.indexOf(colName);
  }

  async function markContactRowSent(token, sheetRowNumber) {
    let idx = await getContactsHeaderIndex(token, SHEETS_CONFIG.sentColName);
    if (idx < 0) idx = CONTACTS_HEADER.indexOf(SHEETS_CONFIG.sentColName);
    if (idx < 0) {
      console.warn("markContactRowSent: Sent column not found in Bark_Contacts header");
      return;
    }
    const col = colNumToA1(idx + 1);
    const range = a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab) + "!" + col + String(sheetRowNumber);
    await sheetsValuesUpdate(token, range, [["sent"]]);
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (o) => resolve(o || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      chrome.storage.local.set(obj, () => resolve());
    });
  }

  async function getMailRelaySettings() {
    const o = await storageGet(["autoSendEmailOnMatch", "mailRelayUrl", "mailRelaySecret"]);
    return {
      enabled: o.autoSendEmailOnMatch === true,
      url: String(o.mailRelayUrl || DEFAULT_MAIL_RELAY_URL).trim() || DEFAULT_MAIL_RELAY_URL,
      secret: String(o.mailRelaySecret || "").trim(),
    };
  }

  async function getGeminiApiKey() {
    let key = "";
    try {
      key = localStorage.getItem("apiKey") || "";
    } catch (e) {
      /* ignore */
    }
    if (key.trim()) return key.trim();
    const o = await storageGet(["apiKey"]);
    return String(o.apiKey || "").trim();
  }

  function normalizeGeminiModel(model) {
    let m = String(model || "").trim();
    if (!m) return DEFAULT_EMAIL_MODEL;
    if (m.indexOf("models/") === 0) m = m.slice("models/".length);
    if (/^gpt-/i.test(m) || /^o\d/i.test(m) || /^text-davinci/i.test(m)) return DEFAULT_EMAIL_MODEL;
    return m || DEFAULT_EMAIL_MODEL;
  }

  async function getEmailGenerationModel() {
    const o = await storageGet(["emailGenerationModel"]);
    return normalizeGeminiModel(o.emailGenerationModel);
  }

  function serviceToRolePhrase(service) {
    const s = String(service || "").trim();
    if (s === "Architectural Services") return "a Senior Architect";
    if (s === "Structural Engineer") return "a Structural Engineer";
    if (s === "Residential Interior Designers" || s === "Commercial Interior Designers") return "an Interior Designer";
    return "a professional";
  }

  function buildRoleIntro(service) {
    return serviceToRolePhrase(service) + " with " + OUTREACH_COMPANY;
  }

  /** Subject line: e.g. "Structural Engineering Services in Watertown" */
  function serviceToSubjectServicePhrase(service) {
    const s = String(service || "").trim();
    if (s === "Architectural Services") return "Architectural Services";
    if (s === "Structural Engineer") return "Structural Engineering Services";
    if (s === "Residential Interior Designers" || s === "Commercial Interior Designers") {
      return "Interior Design Services";
    }
    if (s) {
      if (/services$/i.test(s)) return s;
      return s + " Services";
    }
    return "Professional Services";
  }

  function buildOutreachEmailSubject(lead) {
    const phrase = serviceToSubjectServicePhrase(lead && lead.service);
    const loc = normalizeLocationCityStateZip((lead && lead.location) || "");
    let city = (loc.city || "").trim();
    if (!city) {
      const raw = String((lead && lead.location) || "").trim();
      const beforeComma = raw.split(",")[0] || "";
      city = beforeComma.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    }
    if (!city) city = "your area";
    return phrase + " in " + city;
  }

  function parseGeminiJsonContent(content) {
    let text = String(content || "").trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    const brace = text.match(/\{[\s\S]*\}/);
    if (brace) text = brace[0];
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Gemini returned invalid JSON for email body");
    }
  }

  function geminiGenerateContentViaBackground(opts) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        {
          action: "geminiGenerateContent",
          model: opts.model,
          systemInstruction: opts.systemInstruction,
          userText: opts.userText,
          temperature: opts.temperature,
          responseMimeType: opts.responseMimeType,
        },
        function (resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!resp || resp.success !== true) {
            reject(new Error((resp && resp.error) || "Gemini request failed"));
            return;
          }
          resolve(resp.text);
        }
      );
    });
  }

  async function generateOutreachEmail(lead) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) throw new Error("Gemini API key not set in Settings");

    const greetingFirstName = greetingFirstNameFromBarkRow(lead && lead.barkName);
    const roleIntro = buildRoleIntro(lead && lead.service);
    const model = await getEmailGenerationModel();

    const subject = buildOutreachEmailSubject(lead);

    const userPayload = {
      greetingFirstName: greetingFirstName,
      greetingLine: greetingFirstName ? "Hi " + greetingFirstName + "," : "Hi,",
      roleIntro: roleIntro,
      service: String((lead && lead.service) || "").trim(),
      location: String((lead && lead.location) || "").trim(),
      detailsQa: String((lead && lead.details) || "").trim(),
      barkClientName: String((lead && lead.barkName) || "").trim(),
    };

    const systemInstruction =
      "You write short, friendly outreach emails for " +
      OUTREACH_SENDER +
      " at " +
      OUTREACH_COMPANY +
      ". " +
      "The goal is to introduce Thomas and respond to a Bark.com service request. " +
      'Return valid JSON only with key "body" (no subject — subject is set separately). ' +
      "body rules — plain text only, friendly and short:\n" +
      "1) First line must be exactly greetingLine from the user JSON (Hi <name>, or Hi, if no name). Then one blank line.\n" +
      "2) Next paragraph (single line): start with I'm " +
      OUTREACH_SENDER +
      ", then a comma and a space, then paste the exact roleIntro string from the user JSON.\n" +
      "3) After that intro line, put one blank line (\\n\\n) before each following paragraph. " +
      "Use 2–4 short paragraphs: acknowledge their Bark request, offer help, brief CTA. " +
      "Do not run those into one wall of text; each paragraph is separated by \\n\\n from the next.\n" +
      "4) After the last body paragraph, one blank line, then exactly:\nBest regards,\\n" +
      OUTREACH_SENDER +
      "\n5) No phone, website, HTML, or extra signature.";

    const content = await geminiGenerateContentViaBackground({
      model: model,
      systemInstruction: systemInstruction,
      userText: JSON.stringify(userPayload),
      temperature: 0.7,
      responseMimeType: "application/json",
    });

    const parsed = parseGeminiJsonContent(content);
    let body = String(parsed.body || "").trim();
    if (!body) throw new Error("Gemini returned empty body");
    body = applyEmailGreeting(body, greetingFirstName);
    return { subject: subject, body: body };
  }

  async function sendMatchEmailViaRelay(recipients, contactName, subject, body) {
    const mail = await getMailRelaySettings();
    const to = (recipients || []).filter((e) => e && String(e).trim());
    if (!to.length) throw new Error("No recipient addresses");
    const headers = { "Content-Type": "application/json" };
    if (mail.secret) headers["X-Relay-Secret"] = mail.secret;
    const res = await fetch(mail.url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        to: to,
        name: String(contactName || "").trim() || "there",
        subject: String(subject || "").trim(),
        body: String(body || "").trim(),
      }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok || !data || data.success !== true) {
      const err = (data && data.error) || "HTTP " + res.status;
      throw new Error(err);
    }
    return data;
  }

  /** Auto Search: one Gemini draft per cycle; one SMTP send per unique email address. */
  async function autoSendEmailsForNewContacts(token, sendPlans, statusEl) {
    const mail = await getMailRelaySettings();
    if (!mail.enabled || !sendPlans || !sendPlans.length) return { sent: 0, failed: 0 };

    const plansWithEmail = sendPlans.filter(function (p) {
      return p.emails && p.emails.length;
    });
    if (!plansWithEmail.length) return { sent: 0, failed: 0 };

    const batches = collectUniqueEmailSendBatches(plansWithEmail);
    if (!batches.length) return { sent: 0, failed: 0 };

    const leadForEmail = (plansWithEmail[0] && plansWithEmail[0].lead) || {};
    let generated = null;
    try {
      if (statusEl) {
        showStatus(
          statusEl,
          "Auto Search: drafting email (Gemini) for " + batches.length + " unique address(es)…",
          "info"
        );
      }
      generated = await generateOutreachEmail(leadForEmail);
    } catch (e) {
      console.warn("Auto-send email generation failed", e);
      return { sent: 0, failed: batches.length };
    }

    const relayName = greetingFirstNameFromBarkRow(leadForEmail.barkName) || "";

    let sent = 0;
    let failed = 0;
    for (let j = 0; j < batches.length; j++) {
      const batch = batches[j];
      try {
        if (statusEl) {
          showStatus(
            statusEl,
            "Auto Search: sending email " + (j + 1) + "/" + batches.length + "…",
            "info"
          );
        }
        await sendMatchEmailViaRelay([batch.email], relayName, generated.subject, generated.body);
        const rowsToMark = Array.from(batch.sheetRows);
        for (let r = 0; r < rowsToMark.length; r++) {
          await markContactRowSent(token, rowsToMark[r]);
        }
        sent++;
      } catch (e) {
        failed++;
        console.warn("Auto-send email failed for " + batch.email, e);
      }
    }
    return { sent: sent, failed: failed };
  }

  function buildBarkContactRowFromMatch(m, rec, loc, phonePatternForSheet) {
    const allEmails = extractAllEmails(m.data && m.data.emails);
    const allPhones = extractAllPhones(m.data && m.data.phones);
    const phoneCell = allPhones.length > 0 ? allPhones.join("\n") : String(phonePatternForSheet || "").trim();
    const rowValues = [
      String(m.name || ""),
      String(rec.service || ""),
      String(loc.display || rec.location || ""),
      phoneCell,
      allEmails.join("\n"),
      String(rec.verifiedPhone || ""),
      String(rec.details || ""),
      addedAtString(),
      "",
    ];
    return { rowValues: rowValues, allEmails: allEmails, allPhones: allPhones };
  }

  /** Sheet insert + optional email for one match (notify is separate / immediate). */
  async function persistMatchToBarkContactsAsync(ctx, m, built) {
    if (!ctx.token) {
      const sa = await loadServiceAccountJson();
      ctx.token = await getServiceAccountAccessToken(sa);
    }
    if (!ctx.sheetInfo) {
      ctx.sheetInfo = await ensureContactsSheet(ctx.token);
      await ensureContactsSentHeader(ctx.token);
    }
    await insertContactRowAtTop(ctx.token, ctx.sheetInfo.sheetId, built.rowValues);
    const rec = ctx.rec || {};
    const loc = ctx.loc || normalizeLocationCityStateZip(rec.location);
    if (ctx.mailSettings && ctx.mailSettings.enabled && built.allEmails.length) {
      const sendPlans = [
        {
          sheetRow: 2,
          emails: built.allEmails,
          name: String(m.name || ""),
          lead: {
            barkName: String(rec.name || ""),
            service: String(rec.service || ""),
            location: String(loc.display || rec.location || ""),
            details: String(rec.details || ""),
          },
        },
      ];
      await autoSendEmailsForNewContacts(ctx.token, sendPlans, ctx.statusEl);
    }
  }

  /**
   * Auto Search: notify immediately; queue sheet/email so ThatsThem keeps scanning all names.
   * Inserts are serialized (one row at a time) to avoid concurrent row-2 races.
   */
  function createAutoSearchPersistQueue(ctx) {
    let tail = Promise.resolve();
    let saveErrors = 0;

    return {
      enqueue: function (row) {
        const rec = ctx.rec || {};
        const loc = ctx.loc || normalizeLocationCityStateZip(rec.location);
        const built = buildBarkContactRowFromMatch(row, rec, loc, ctx.phonePatternForSheet);

        notifyContactAdded({
          name: String(row.name || ""),
          emailCount: built.allEmails.length,
          phoneCount: built.allPhones.length,
        });

        row.persisted = "pending";
        tail = tail
          .then(function () {
            return persistMatchToBarkContactsAsync(ctx, row, built);
          })
          .then(function () {
            row.persisted = true;
          })
          .catch(function (err) {
            saveErrors++;
            row.persisted = false;
            console.warn("Bark_Contacts async save failed for " + String(row.name || ""), err);
          });
      },
      flush: function () {
        return tail;
      },
      getSaveErrors: function () {
        return saveErrors;
      },
    };
  }

  async function insertContactRowAtTop(token, contactsSheetId, rowValues) {
    // Insert one row at index 1 (i.e. row 2, below header).
    await sheetsBatchUpdate(token, [
      {
        insertDimension: {
          range: {
            sheetId: contactsSheetId,
            dimension: "ROWS",
            startIndex: 1,
            endIndex: 2,
          },
          inheritFromBefore: false,
        },
      },
    ]);
    await sheetsValuesUpdate(token, a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab) + "!A2", [rowValues]);
    try {
      await refreshBarkStatistics(token);
    } catch (e) {
      console.warn("Bark_Statistics refresh failed", e);
    }
  }

  async function insertContactRowsAtTop(token, contactsSheetId, rowsValues) {
    const rows = Array.isArray(rowsValues) ? rowsValues.filter((r) => Array.isArray(r) && r.length) : [];
    if (rows.length === 0) return;
    // Insert N rows at index 1 (i.e. starting at row 2, below header).
    await sheetsBatchUpdate(token, [
      {
        insertDimension: {
          range: {
            sheetId: contactsSheetId,
            dimension: "ROWS",
            startIndex: 1,
            endIndex: 1 + rows.length,
          },
          inheritFromBefore: false,
        },
      },
    ]);
    await sheetsValuesUpdate(token, a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab) + "!A2", rows);
    try {
      await refreshBarkStatistics(token);
    } catch (e) {
      console.warn("Bark_Statistics refresh failed", e);
    }
  }

  async function waitTabComplete(tabId, timeoutMs) {
    const start = Date.now();
    return await new Promise((resolve, reject) => {
      const t = typeof timeoutMs === "number" ? timeoutMs : 45000;
      const timer = setInterval(() => {
        if (Date.now() - start > t) {
          clearInterval(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          reject(new Error("Google tab load timeout"));
        }
      }, 250);
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === "complete") {
          clearInterval(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(true);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.status === "complete") {
          clearInterval(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(true);
        }
      });
    });
  }

  function googleSearchUrl(criteria) {
    const q = String(criteria || "").trim();
    return "https://www.google.com/search?hl=en&gl=us&pws=0&q=" + encodeURIComponent(q);
  }

  function newGoogleExtractionRunId() {
    return "g_" + String(Date.now()) + "_" + Math.random().toString(36).slice(2, 10);
  }

  /** Stop any in-flight Google crawl and close its tab so a new cycle cannot inherit names. */
  async function abortPriorGoogleExtraction() {
    await new Promise((resolve) => {
      chrome.storage.local.set(
        {
          stopGoogleExtraction: true,
          googleExtractionState: null,
          googleCurrentNames: [],
          googleExtractionDone: null,
        },
        resolve
      );
    });
    const st = await storageGetLocal(["googleExtractionTabId"]);
    const priorTabId = st.googleExtractionTabId;
    if (priorTabId != null) {
      try {
        await chrome.tabs.remove(priorTabId);
      } catch (e) {
        /* tab may already be closed */
      }
    }
    await new Promise((resolve) => {
      chrome.storage.local.set({ googleExtractionTabId: null, stopGoogleExtraction: false }, resolve);
    });
  }

  function storageGetLocal(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (o) => resolve(o || {}));
    });
  }

  async function pollGoogleExtractionDone(sinceMs, runId) {
    const since = typeof sinceMs === "number" ? sinceMs : 0;
    const expectedRunId = String(runId || "");
    while (true) {
      const st = await storageGetLocal(["googleExtractionDone"]);
      const done = st.googleExtractionDone;
      if (
        done &&
        typeof done.at === "number" &&
        done.at >= since &&
        (!expectedRunId || String(done.runId || "") === expectedRunId)
      ) {
        return {
          action: "googleExtractionComplete",
          names: Array.isArray(done.names) ? done.names : [],
          pageCount: done.pageCount,
          runId: done.runId,
          error: done.geminiError || null,
        };
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  async function extractGoogleNamesFromCriteria(firstname, criteria, onProgress) {
    await abortPriorGoogleExtraction();

    const extractionRunId = newGoogleExtractionRunId();
    const extractionStartedAt = Date.now();
    await new Promise((resolve) => {
      chrome.storage.local.set(
        { googleExtractionDone: null, googleExtractionRunId: extractionRunId },
        resolve
      );
    });

    const url = googleSearchUrl(criteria);
    const tab = await chrome.tabs.create({ url, active: false });
    const tabId = tab && tab.id;
    if (!tabId) throw new Error("Failed to open Google tab");

    await new Promise((resolve) => {
      chrome.storage.local.set({ googleExtractionTabId: tabId }, resolve);
    });

    let shouldCloseTab = true;
    let progressTimer = null;
    let runtimeWaitListener = null;

    const waitForRuntimeMessage = (allowedActions) => {
      return new Promise((resolve) => {
        const fn = (msg) => {
          if (!msg || allowedActions.indexOf(msg.action) === -1) return;
          if (
            (msg.action === "googleExtractionComplete" || msg.action === "googleExtractionBlocked") &&
            msg.runId &&
            String(msg.runId) !== extractionRunId
          ) {
            return;
          }
          runtimeWaitListener = null;
          chrome.runtime.onMessage.removeListener(fn);
          resolve(msg);
        };
        runtimeWaitListener = fn;
        chrome.runtime.onMessage.addListener(fn);
      });
    };

    const sendExtract = async (resume) =>
      await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tabId,
          {
            action: "extractNamesGoogle",
            firstname: String(firstname || "").trim(),
            resume: !!resume,
            runId: extractionRunId,
          },
          resolve
        );
      });

    const sendCaptchaStatus = async () =>
      await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: "googleCaptchaStatus" }, resolve);
      });

    const getTabUrl = async () =>
      await new Promise((resolve) => {
        chrome.tabs.get(tabId, (t) => resolve(t && t.url ? String(t.url) : ""));
      });

    const looksBlockedUrl = (u) => {
      const s = String(u || "");
      return s.includes("google.com/sorry") || s.includes("/sorry/") || s.includes("recaptcha");
    };

    const stopRequested = async () =>
      !!(await new Promise((resolve) => {
        chrome.storage.local.get(["stopGoogleExtraction"], (o) => resolve(o && o.stopGoogleExtraction === true));
      }));

    /** No time limit — only Stop Google cancels. */
    const waitCaptchaResolvedForever = async () => {
      while (true) {
        if (await stopRequested()) {
          throw new Error("Google extraction stopped by user");
        }
        await new Promise((r) => setTimeout(r, 2000));
        let st = null;
        try {
          st = await sendCaptchaStatus();
        } catch (e) {
          st = null;
        }
        const stillBlocked = st && st.success === true ? st.blocked === true : null;
        const tabUrl = await getTabUrl();
        if (stillBlocked === false) return;
        if (!looksBlockedUrl(tabUrl) && tabUrl.includes("google.com/search")) return;
      }
    };

    const reloadTabOnce = () =>
      new Promise((resolve, reject) => {
        chrome.tabs.reload(tabId, { bypassCache: true }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(undefined);
        });
      });

    try {
      await waitTabComplete(tabId, 45000);
      // Second navigation often yields fuller SERP markup than the first paint.
      try {
        await reloadTabOnce();
        await waitTabComplete(tabId, 45000);
      } catch (e) {
        console.warn("Google search: reload before extract failed, continuing with first load.", e);
      }

      let res = await sendExtract(false);

      if (!res || res.blocked) {
        shouldCloseTab = false;
        if (typeof onProgress === "function") onProgress({ blocked: true, pageNum: 1 });
        try {
          await chrome.tabs.update(tabId, { active: true });
        } catch (e) {
          /* ignore */
        }
        await waitCaptchaResolvedForever();
        shouldCloseTab = true;
        res = await sendExtract(true);
      }

      if (!res || res.success !== true) throw new Error((res && res.error) || "Google extraction failed");

      if (!res.navigating) {
        return Array.isArray(res.names) ? res.names : [];
      }

      if (typeof onProgress === "function") {
        progressTimer = setInterval(() => {
          try {
            chrome.storage.local.get(["googleExtractionState"], (st) => {
              const gs = st && st.googleExtractionState ? st.googleExtractionState : null;
              const pageNum = gs && typeof gs.pageNum === "number" ? gs.pageNum : null;
              if (pageNum != null) onProgress({ pageNum });
            });
          } catch (e) {
            /* ignore */
          }
        }, 800);
      }

      // Wait until last page finishes. Poll storage as fallback if runtime message is missed.
      while (true) {
        const msg = await Promise.race([
          waitForRuntimeMessage(["googleExtractionComplete", "googleExtractionBlocked"]),
          pollGoogleExtractionDone(extractionStartedAt, extractionRunId),
        ]);
        if (msg.action === "googleExtractionBlocked") {
          shouldCloseTab = false;
          if (typeof onProgress === "function") onProgress({ blocked: true, pageNum: msg.pageNum || null });
          try {
            await chrome.tabs.update(tabId, { active: true });
          } catch (e) {
            /* ignore */
          }
          await waitCaptchaResolvedForever();
          shouldCloseTab = true;
          await sendExtract(true);
          continue;
        }
        if (msg.action === "googleExtractionComplete") {
          if (msg.error && (!msg.names || !msg.names.length)) {
            throw new Error("Gemini: " + msg.error);
          }
          return Array.isArray(msg.names) ? msg.names : [];
        }
      }
    } finally {
      try {
        if (progressTimer) clearInterval(progressTimer);
        if (runtimeWaitListener) {
          try {
            chrome.runtime.onMessage.removeListener(runtimeWaitListener);
          } catch (e2) {
            /* ignore */
          }
          runtimeWaitListener = null;
        }
      } catch (e) {
        /* ignore */
      }
      try {
        if (shouldCloseTab) await chrome.tabs.remove(tabId);
      } catch (e) {
        /* ignore */
      }
      try {
        await new Promise((resolve) => {
          chrome.storage.local.get(["googleExtractionTabId"], (st) => {
            if (st && st.googleExtractionTabId === tabId) {
              chrome.storage.local.set({ googleExtractionTabId: null }, resolve);
            } else {
              resolve();
            }
          });
        });
      } catch (e) {
        /* ignore */
      }
    }
  }

  function showStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = "status " + kind;
    el.style.display = "block";
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (o) {
        resolve(o || {});
      });
    });
  }

  function storageSet(obj) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(obj, resolve);
    });
  }

  function parseSheetsTopN(raw) {
    const n = parseInt(String(raw), 10);
    return n > 0 ? n : DEFAULT_SHEETS_TOP_N;
  }

  function applySheetsTopN(n) {
    SHEETS_CONFIG.topN = parseSheetsTopN(n);
    return SHEETS_CONFIG.topN;
  }

  function loadSheetsTopNFromStorage() {
    return storageGet(["sheetsTopN"]).then(function (o) {
      return applySheetsTopN(o.sheetsTopN);
    });
  }

  function notifyContactAdded(opts) {
    const name = opts && opts.name ? String(opts.name) : "";
    const emailCount = opts && typeof opts.emailCount === "number" ? opts.emailCount : null;
    const phoneCount = opts && typeof opts.phoneCount === "number" ? opts.phoneCount : null;
    const lines = [];
    if (emailCount != null) lines.push("Emails: " + String(emailCount));
    if (phoneCount != null) lines.push("Phones: " + String(phoneCount));
    const detail = lines.length ? lines.join(" · ") : "Saved to Bark_Contacts";
    const message = (name ? name + " — " : "") + detail;
    const notificationId = "bark_contacts_added_" + String(Date.now()) + "_" + String(Math.random()).slice(2, 8);

    if (!chrome || !chrome.notifications || typeof chrome.notifications.create !== "function") {
      console.warn("chrome.notifications API not available");
      return;
    }

    const iconUrl = chrome.runtime.getURL("icon.png");
    const options = {
      type: "basic",
      iconUrl: iconUrl,
      title: "Bark contact added",
      message: message,
      priority: 2,
      requireInteraction: true,
      silent: false,
    };

    try {
      chrome.notifications.create(notificationId, options, function () {
        if (chrome.runtime.lastError) {
          console.warn("Side panel notification failed:", chrome.runtime.lastError.message);
          try {
            chrome.runtime.sendMessage({
              action: "showBarkNotification",
              title: "Bark contact added",
              message: message,
              notificationId: notificationId + "_sw",
            });
          } catch (e2) {
            /* ignore */
          }
        }
      });
    } catch (e) {
      console.warn("Side panel notification failed", e);
      try {
        chrome.runtime.sendMessage({
          action: "showBarkNotification",
          title: "Bark contact added",
          message: message,
          notificationId: notificationId + "_sw",
        });
      } catch (e2) {
        /* ignore */
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function filterByEmailPattern(rows, pattern) {
    if (!pattern) return [];
    const M = typeof EmailPatternMatch !== "undefined" ? EmailPatternMatch : null;
    if (M && M.filterRows) {
      return M.filterRows(rows, pattern.trim());
    }
    const re = new RegExp(
      "^" + pattern.replace(/([.+?^${}()|[\]\\])/g, "\\$1").replace(/\*/g, ".") + "$",
      "i"
    );
    return (rows || []).filter(function (s) {
      return typeof s === "string" && re.test(s);
    });
  }

  function filterByPhonePattern(rows, pattern) {
    if (!pattern) return [];
    const P = typeof PhonePatternMatch !== "undefined" ? PhonePatternMatch : null;
    if (P && P.filterPhoneRows) return P.filterPhoneRows(rows, pattern.trim());
    if (P && P.filterPhones) return P.filterPhones(rows, pattern.trim());
    const re = new RegExp(
      "^" + pattern.replace(/([.+?^${}()|[\]\\])/g, "\\$1").replace(/\*/g, ".") + "$",
      "i"
    );
    return (rows || []).filter(function (s) {
      return typeof s === "string" && re.test(s.replace(/\s+/g, " ").trim());
    });
  }

  function aggKey(x) {
    return typeof x === "string" ? "s:" + x.trim().toLowerCase() : "o:" + JSON.stringify(x);
  }

  function dedupeAgg(arr) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < (arr || []).length; i++) {
      const k = aggKey(arr[i]);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(arr[i]);
    }
    return out;
  }

  /**
   * Per .record card (email pattern gates which cards are considered):
   * - No phone pattern: show every phone on each card that has a matching email.
   * - Phone pattern set (optional filter): still require matching email on the card;
   *   add phones that match the pattern when any; if none match, that card still
   *   contributes matching emails only. Row matches when email criteria is met.
   */
  function computeThatsThemMatches(raw, emailPattern, phonePattern) {
    const wantEmail = !!emailPattern;
    const wantPhone = !!phonePattern;

    if (raw && Array.isArray(raw.cards) && raw.cards.length > 0) {
      const aggE = [];
      const aggP = [];
      for (let ci = 0; ci < raw.cards.length; ci++) {
        const card = raw.cards[ci] || {};
        const cardEmails = card.emails || [];
        const cardPhones = card.phones || [];
        const hitE = wantEmail ? filterByEmailPattern(cardEmails, emailPattern) : [];
        if (wantEmail && hitE.length === 0) continue;

        if (wantPhone) {
          const hitP = filterByPhonePattern(cardPhones, phonePattern);
          if (wantEmail) {
            aggE.push.apply(aggE, hitE);
            if (hitP.length > 0) aggP.push.apply(aggP, hitP);
          } else {
            aggP.push.apply(aggP, hitP);
          }
        } else if (wantEmail) {
          aggE.push.apply(aggE, hitE);
          aggP.push.apply(aggP, cardPhones);
        }
      }
      const emails = dedupeAgg(aggE);
      const phones = dedupeAgg(aggP);
      const matched =
        (wantEmail || wantPhone) &&
        (!wantEmail || emails.length > 0) &&
        (!wantPhone || wantEmail || phones.length > 0);
      return { emails: emails, phones: phones, matched: matched };
    }

    if (Array.isArray(raw)) {
      const emails = wantEmail ? filterByEmailPattern(raw, emailPattern) : [];
      const phones = [];
      const matched =
        (wantEmail || wantPhone) &&
        (!wantEmail || emails.length > 0) &&
        (!wantPhone || wantEmail || phones.length > 0);
      return { emails: emails, phones: phones, matched: matched };
    }

    const flatE = raw && raw.emails ? raw.emails : [];
    const flatP = raw && raw.phones ? raw.phones : [];
    const hitE = wantEmail ? filterByEmailPattern(flatE, emailPattern) : [];
    const hitP = wantPhone ? filterByPhonePattern(flatP, phonePattern) : [];
    let phonesOut = hitP;
    if (wantEmail && !wantPhone && hitE.length > 0 && flatP.length) {
      phonesOut = dedupeAgg(flatP);
    }
    const matched =
      (wantEmail || wantPhone) &&
      (!wantEmail || hitE.length > 0) &&
      (!wantPhone || wantEmail || hitP.length > 0);
    return { emails: hitE, phones: phonesOut, matched: matched };
  }

  function formatDataBlock(emails, phones) {
    const parts = [];
    if (emails.length > 0) {
      parts.push(
        "<strong>Email:</strong><br>" +
          emails
            .map(function (r) {
              const line =
                typeof EmailPatternMatch !== "undefined" && EmailPatternMatch.formatRowForDisplay
                  ? EmailPatternMatch.formatRowForDisplay(r)
                  : String(r);
              return escapeHtml(line);
            })
            .join("<br>")
      );
    }
    if (phones.length > 0) {
      parts.push(
        "<strong>Phone:</strong><br>" +
          phones
            .map(function (p) {
              const line =
                typeof PhonePatternMatch !== "undefined" && PhonePatternMatch.formatPhoneRowForDisplay
                  ? PhonePatternMatch.formatPhoneRowForDisplay(p)
                  : String(p);
              return escapeHtml(line);
            })
            .join("<br>")
      );
    }
    return parts.length > 0 ? parts.join("<br><br>") : "None";
  }

  function appendResult(resultsEl, payload) {
    if (!resultsEl || !payload) return;
    const t = document.createElement("div");
    t.className = "result-item " + (payload.matched ? "matched" : "");
    const d = payload.data || {};
    const emails = d.emails || [];
    const phones = d.phones || [];
    t.innerHTML = `
      <div class="result-name">
        <a href="${payload.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(payload.name)}</a>
      </div>
      <div class="result-data">
        <strong>Data found:</strong>
        <span class="result-data-lines">${formatDataBlock(emails, phones)}</span>
      </div>
    `;
    resultsEl.appendChild(t);
  }

  function stateSelectToAbbrev(stateEl) {
    const opt = stateEl && stateEl.selectedOptions && stateEl.selectedOptions[0];
    if (!opt) return "";
    const m = (opt.textContent || "").trim().match(/^([A-Z]{2})\s*-/);
    return m ? m[1] : "";
  }

  function buildThatsThemUrl(nameLine, city, stateAbbr) {
    const nameSlug = nameLine.trim().replace(/\s+/g, "-").replace(/-+/g, "-");
    const citySlug = city
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .replace(/-+/g, "-");
    return "https://thatsthem.com/name/" + nameSlug + "/" + citySlug + "-" + stateAbbr;
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    const sheetsTopNInput = document.getElementById("sheetsTopN");
    const autoSearchIntervalMinutesEl = document.getElementById("autoSearchIntervalMinutes");
    const settingsStatusEl = document.getElementById("settingsStatus");
    const apiKeyEl = document.getElementById("apiKey");
    const saveSettingsBtn = document.getElementById("saveSettings");
    const autoSendEmailOnMatchEl = document.getElementById("autoSendEmailOnMatch");
    const mailRelayUrlEl = document.getElementById("mailRelayUrl");
    const mailRelaySecretEl = document.getElementById("mailRelaySecret");
    const emailGenerationModelEl = document.getElementById("emailGenerationModel");

    function showSettingsSaveStatus(text, kind) {
      showStatus(settingsStatusEl, text, kind);
      if (settingsStatusEl) {
        setTimeout(function () {
          settingsStatusEl.style.display = "none";
        }, 5000);
      }
    }

    function updateMailRelayFieldsEnabled() {
      const on = !!(autoSendEmailOnMatchEl && autoSendEmailOnMatchEl.checked);
      if (mailRelayUrlEl) mailRelayUrlEl.disabled = !on;
      if (mailRelaySecretEl) mailRelaySecretEl.disabled = !on;
      if (emailGenerationModelEl) emailGenerationModelEl.disabled = !on;
    }

    if (apiKeyEl) {
      try {
        const lsKey = localStorage.getItem("apiKey");
        if (lsKey) apiKeyEl.value = lsKey;
      } catch (e) {
        /* ignore */
      }
      storageGet(["apiKey"]).then(function (o) {
        const key = String(o.apiKey || "").trim();
        if (key) {
          apiKeyEl.value = key;
          try {
            localStorage.setItem("apiKey", key);
          } catch (e2) {
            /* ignore */
          }
        } else if (apiKeyEl.value.trim()) {
          storageSet({ apiKey: apiKeyEl.value.trim() });
        }
      });
    }

    if (sheetsTopNInput) {
      try {
        const lsTopN = localStorage.getItem("sheetsTopN");
        if (lsTopN) applySheetsTopN(lsTopN);
        sheetsTopNInput.value = String(SHEETS_CONFIG.topN);
      } catch (e) {
        /* ignore */
      }
      loadSheetsTopNFromStorage().then(function (n) {
        sheetsTopNInput.value = String(n);
        try {
          localStorage.setItem("sheetsTopN", String(n));
        } catch (e2) {
          /* ignore */
        }
      });
    }

    if (autoSearchIntervalMinutesEl) {
      try {
        const lsInterval = localStorage.getItem("autoSearchIntervalMinutes");
        if (lsInterval) applyAutoSearchIntervalMinutes(lsInterval);
        autoSearchIntervalMinutesEl.value = String(autoSearchIntervalMinutes);
      } catch (e) {
        /* ignore */
      }
      storageGet(["autoSearchIntervalMinutes"]).then(function (o) {
        const n = applyAutoSearchIntervalMinutes(o.autoSearchIntervalMinutes);
        autoSearchIntervalMinutesEl.value = String(n);
        try {
          localStorage.setItem("autoSearchIntervalMinutes", String(n));
        } catch (e2) {
          /* ignore */
        }
      });
    }

    storageGet([
      "autoSendEmailOnMatch",
      "mailRelayUrl",
      "mailRelaySecret",
      "emailGenerationModel",
    ]).then(function (o) {
      if (autoSendEmailOnMatchEl) autoSendEmailOnMatchEl.checked = o.autoSendEmailOnMatch === true;
      if (mailRelayUrlEl) mailRelayUrlEl.value = o.mailRelayUrl || DEFAULT_MAIL_RELAY_URL;
      if (mailRelaySecretEl) mailRelaySecretEl.value = o.mailRelaySecret || "";
      const normalizedEmailModel = normalizeGeminiModel(o.emailGenerationModel);
      if (o.emailGenerationModel && normalizedEmailModel !== o.emailGenerationModel) {
        storageSet({ emailGenerationModel: normalizedEmailModel });
      }
      if (emailGenerationModelEl) {
        emailGenerationModelEl.value = normalizedEmailModel;
      }
      updateMailRelayFieldsEnabled();
    });

    if (autoSendEmailOnMatchEl) {
      autoSendEmailOnMatchEl.addEventListener("change", updateMailRelayFieldsEnabled);
    }

    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener("click", async function () {
        const key = apiKeyEl ? apiKeyEl.value.trim() : "";
        if (key) {
          try {
            localStorage.setItem("apiKey", key);
          } catch (e) {
            /* ignore */
          }
          await storageSet({ apiKey: key });
        }

        if (sheetsTopNInput) {
          const raw = sheetsTopNInput.value.trim();
          const n = parseInt(raw, 10);
          if (!raw || !Number.isFinite(n) || n < 1) {
            showSettingsSaveStatus("Top N: enter a whole number at least 1.", "error");
            return;
          }
          const clamped = Math.min(5000, Math.max(1, n));
          applySheetsTopN(clamped);
          sheetsTopNInput.value = String(clamped);
          try {
            localStorage.setItem("sheetsTopN", String(clamped));
          } catch (e) {
            /* ignore */
          }
          await storageSet({ sheetsTopN: clamped });
        }

        if (autoSearchIntervalMinutesEl) {
          const rawInterval = autoSearchIntervalMinutesEl.value.trim();
          const intervalN = parseInt(rawInterval, 10);
          if (!rawInterval || !Number.isFinite(intervalN) || intervalN < 1) {
            showSettingsSaveStatus("Auto Search interval: enter a whole number of minutes (at least 1).", "error");
            return;
          }
          const clampedInterval = applyAutoSearchIntervalMinutes(intervalN);
          autoSearchIntervalMinutesEl.value = String(clampedInterval);
          try {
            localStorage.setItem("autoSearchIntervalMinutes", String(clampedInterval));
          } catch (e) {
            /* ignore */
          }
          await storageSet({ autoSearchIntervalMinutes: clampedInterval });
        }

        await storageSet({
          autoSendEmailOnMatch: !!(autoSendEmailOnMatchEl && autoSendEmailOnMatchEl.checked),
          mailRelayUrl: (mailRelayUrlEl && mailRelayUrlEl.value.trim()) || DEFAULT_MAIL_RELAY_URL,
          mailRelaySecret: mailRelaySecretEl ? mailRelaySecretEl.value.trim() : "",
          emailGenerationModel: normalizeGeminiModel(
            (emailGenerationModelEl && emailGenerationModelEl.value.trim()) || DEFAULT_EMAIL_MODEL
          ),
        });

        showSettingsSaveStatus("Settings saved.", "success");
      });
    }

    const searchThatsThemBtn = document.getElementById("searchThatsThemBtn");
    const stopThatsThemSearch = document.getElementById("stopThatsThemSearch");
    const autoSearchSheetBtn = document.getElementById("autoSearchSheetBtn");
    const firstnameEl = document.getElementById("firstname");
    const emailPatternEl = document.getElementById("emailPattern");
    const phonePatternEl = document.getElementById("phonePattern");
    const cityEl = document.getElementById("city");
    const stateEl = document.getElementById("state");
    const nameList = document.getElementById("nameList");
    const statusEl = document.getElementById("status");
    const autoSearchCountdownEl = document.getElementById("autoSearchCountdown");
    const resultsEl = document.getElementById("results");

    if (!searchThatsThemBtn || !nameList) return;

    let stopThatsThem = false;
    let thatsThemRunning = false;

    if (stopThatsThemSearch) {
      stopThatsThemSearch.addEventListener("click", function () {
        stopThatsThem = true;
        showStatus(statusEl, "Stopping ThatsThem…", "info");
      });
    }

    async function runThatsThemFromUi(opts) {
      if (thatsThemRunning) {
        showStatus(statusEl, "ThatsThem is already running — wait for it to finish.", "error");
        return [];
      }
      thatsThemRunning = true;
      const options = opts || {};
      const controlButtons = options.controlButtons !== false; // default true
      try {
        const first = (firstnameEl && firstnameEl.value.trim()) || "";
        const emailPattern = (emailPatternEl && emailPatternEl.value.trim()) || "";
        const phonePattern = (phonePatternEl && phonePatternEl.value.trim()) || "";
        const city = (cityEl && cityEl.value.trim()) || "";
        const stateAbbr = stateSelectToAbbrev(stateEl);
        const lines = nameList.value.split("\n").filter(function (l) {
          return l.trim();
        });

        if (!first || !stateAbbr || !city || lines.length === 0) {
          showStatus(
            statusEl,
            "Please fill first name, city, and state, extract names into the list, then try again.",
            "error"
          );
          return [];
        }

        if (!emailPattern && !phonePattern) {
          showStatus(statusEl, "Please enter an email pattern and/or a phone pattern.", "error");
          return [];
        }

        stopThatsThem = false;
        if (controlButtons) {
          searchThatsThemBtn.disabled = true;
          searchThatsThemBtn.style.display = "none";
          if (stopThatsThemSearch) {
            stopThatsThemSearch.style.display = "block";
            stopThatsThemSearch.disabled = false;
          }
        }
        if (resultsEl) resultsEl.innerHTML = "";
        showStatus(statusEl, "ThatsThem: processing " + lines.length + " name(s)…", "info");

        const results = [];
        for (let i = 0; i < lines.length; i++) {
          if (stopThatsThem) {
            showStatus(
              statusEl,
              "ThatsThem stopped. Processed " +
                i +
                "/" +
                lines.length +
                " names, found " +
                results.filter(function (r) {
                  return r.matched;
                }).length +
                " matches.",
              "info"
            );
            break;
          }

          const nameLine = lines[i].trim();
          if (!nameLine) continue;

          const url = buildThatsThemUrl(nameLine, city, stateAbbr);

          showStatus(statusEl, "ThatsThem " + (i + 1) + "/" + lines.length + ": " + nameLine + "…", "info");

          try {
            const res = await new Promise(function (resolve) {
              chrome.runtime.sendMessage({ action: "fetchPageDataThatsThem", url: url }, resolve);
            });
            const raw = (res && res.data) || null;
            const m = computeThatsThemMatches(raw, emailPattern, phonePattern);
            const row = {
              name: nameLine,
              url: url,
              data: { emails: m.emails, phones: m.phones },
              matched: m.matched,
            };
            results.push(row);
            if (row.matched) {
              appendResult(resultsEl, row);
              if (options.persistOnMatch && options.contactsCtx) {
                if (typeof options.enqueuePersistMatch === "function") {
                  options.enqueuePersistMatch(row);
                } else if (options.stopAfterFirstMatch) {
                  try {
                    const rec = options.contactsCtx.rec || {};
                    const loc =
                      options.contactsCtx.loc || normalizeLocationCityStateZip(rec.location);
                    const built = buildBarkContactRowFromMatch(
                      row,
                      rec,
                      loc,
                      options.contactsCtx.phonePatternForSheet
                    );
                    notifyContactAdded({
                      name: String(row.name || ""),
                      emailCount: built.allEmails.length,
                      phoneCount: built.allPhones.length,
                    });
                    await persistMatchToBarkContactsAsync(options.contactsCtx, row, built);
                    row.persisted = true;
                  } catch (persistErr) {
                    console.warn("Bark_Contacts save failed", persistErr);
                    showStatus(
                      statusEl,
                      "Match found but save failed: " +
                        (persistErr && persistErr.message ? persistErr.message : String(persistErr)),
                      "error"
                    );
                  }
                  stopThatsThem = true;
                  showStatus(statusEl, "ThatsThem: first match saved, stopping search.", "success");
                  break;
                }
              }
            }
          } catch (e) {
            /* next */
          }

          await new Promise(function (r) {
            setTimeout(r, 500);
          });
        }

        if (controlButtons) {
          searchThatsThemBtn.disabled = false;
          searchThatsThemBtn.style.display = "block";
          if (stopThatsThemSearch) stopThatsThemSearch.style.display = "none";
        }

        const matchedCount = results.filter(function (r) {
          return r.matched;
        }).length;
        const total = results.length;
        if (!stopThatsThem) {
          showStatus(
            statusEl,
            "ThatsThem done. Processed " + total + " name(s), found " + matchedCount + " match(es).",
            matchedCount ? "success" : "error"
          );
        }
        return results;
      } finally {
        thatsThemRunning = false;
      }
    }

    if (autoSearchSheetBtn) {
      let autoSearchRunning = false; // true only while a cycle is executing
      let autoSearchEnabled = false; // true while interval mode is enabled
      let stopAfterCurrentCycle = false;
      let autoSearchTimeoutId = null;
      let countdownIntervalId = null;
      let nextCycleAtMs = null;
      const autoSearchDefaultLabel = autoSearchSheetBtn.textContent || "Auto Search";
      let restoreDisabledState = null;

      function clearAutoSearchTimeout() {
        if (autoSearchTimeoutId) {
          clearTimeout(autoSearchTimeoutId);
          autoSearchTimeoutId = null;
        }
      }

      // Next cycle should START at (plannedStartMs + interval). We pass the *planned* start
      // time (not the actual start), so background timer delays don't shift the cadence.
      function scheduleNextCycleStart(anchorStartMs) {
        clearAutoSearchTimeout();
        if (!autoSearchEnabled) return;
        const intervalMs = getAutoSearchIntervalMs();
        nextCycleAtMs = anchorStartMs + intervalMs;
        const delayMs = Math.max(0, nextCycleAtMs - Date.now());
        startCountdown();
        updateAutoSearchCountdownDisplay();
        autoSearchTimeoutId = setTimeout(function () {
          autoSearchTimeoutId = null;
          onAutoSearchTimer();
        }, delayMs);
      }

      async function onAutoSearchTimer() {
        if (!autoSearchEnabled) return;
        const plannedStartMs = nextCycleAtMs;
        if (autoSearchRunning) {
          showStatus(
            statusEl,
            "Auto Search: previous cycle still running; next start in " + autoSearchIntervalLabel() + "…",
            "info"
          );
          // Missed this start slot — wait another full interval from the planned start time.
          scheduleNextCycleStart(plannedStartMs || Date.now());
          return;
        }
        await runAutoSearchCycle(plannedStartMs || Date.now());
      }

      function formatCountdown(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        return mm + ":" + ss;
      }

      function updateAutoSearchCountdownDisplay() {
        if (!autoSearchCountdownEl || !autoSearchEnabled || !nextCycleAtMs) {
          hideAutoSearchCountdown();
          return;
        }
        const remaining = nextCycleAtMs - Date.now();
        autoSearchCountdownEl.textContent =
          "Auto Search: next cycle starts in " + formatCountdown(remaining);
        autoSearchCountdownEl.className = "status status-countdown info";
        autoSearchCountdownEl.style.display = "block";
      }

      function hideAutoSearchCountdown() {
        if (!autoSearchCountdownEl) return;
        autoSearchCountdownEl.textContent = "";
        autoSearchCountdownEl.style.display = "none";
      }

      function startCountdown() {
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        countdownIntervalId = setInterval(() => {
          if (!autoSearchEnabled || !nextCycleAtMs) return;
          updateAutoSearchCountdownDisplay();
        }, 1000);
      }

      function stopCountdown() {
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        countdownIntervalId = null;
        nextCycleAtMs = null;
        hideAutoSearchCountdown();
      }

      function setOtherButtonsDisabled(disabled) {
        const ids = [
          "extractGoogle",
          "stopGoogle",
          "extractContact",
          "stopContact",
          "extractFast",
          "extractContactScrape",
          "stopContactScrape",
          "applyBarkData",
          "searchUniteBtn",
          "stopSearch",
          "searchZabaBtn",
          "stopZabaSearch",
          "searchThatsThemBtn",
          "stopThatsThemSearch",
        ];
        const els = ids
          .map((id) => document.getElementById(id))
          .filter((x) => x && x !== autoSearchSheetBtn);

        if (disabled) {
          const prev = new Map();
          els.forEach((el) => prev.set(el, !!el.disabled));
          restoreDisabledState = function () {
            els.forEach((el) => {
              const was = prev.get(el);
              if (typeof was === "boolean") el.disabled = was;
            });
          };
          els.forEach((el) => {
            el.disabled = true;
          });
        } else {
          if (typeof restoreDisabledState === "function") restoreDisabledState();
          restoreDisabledState = null;
        }
      }

      async function runAutoSearchCycle(plannedStartMs) {
        if (autoSearchRunning || !autoSearchEnabled) return;
        autoSearchRunning = true;
        const anchorMs = typeof plannedStartMs === "number" ? plannedStartMs : Date.now();
        scheduleNextCycleStart(anchorMs);
        try {
          try {
            const saPrune = await loadServiceAccountJson();
            const tokenPrune = await getServiceAccountAccessToken(saPrune);
            const contactsInfo = await ensureContactsSheet(tokenPrune);
            await maybePruneOldContactsOncePerDay(tokenPrune, contactsInfo.sheetId);
          } catch (pruneErr) {
            console.warn("Bark_Contacts: daily prune skipped", pruneErr);
          }
          // Clear previous cycle results before starting a new one.
          if (resultsEl) resultsEl.innerHTML = "";
          showStatus(statusEl, "Auto Search: checking Google Sheet for Todo…", "info");
          const res = await pickFirstTodoAndMarkInProgress();
          if (!res.picked) {
            showStatus(statusEl, "Auto Search: " + res.reason, "error");
            return;
          }
          const rec = res.record || {};
          const loc = normalizeLocationCityStateZip(rec.location);
          const criteria = `${String(rec.name || "").trim()} living in ${loc.display || rec.location}; ${areaCodePrefix(rec.phone)}`;

          // Fill sidebar fields so you can run Search ThatsThem immediately.
          const fullName = String(rec.name || "").trim();
          const googleMatchToken = firstToken(fullName);

          await abortPriorGoogleExtraction();
          if (nameList) nameList.value = "";

          if (firstnameEl) firstnameEl.value = googleMatchToken || fullName;
          if (cityEl && loc.city) cityEl.value = loc.city;
          if (emailPatternEl && rec.email) emailPatternEl.value = rec.email;
          if (phonePatternEl && rec.phone) phonePatternEl.value = rec.phone;
          if (nameList) nameList.value = googleMatchToken || fullName || "";
          if (stateEl && loc.st) {
            const opts = stateEl.querySelectorAll("option");
            for (let i = 0; i < opts.length; i++) {
              const txt = (opts[i].textContent || "").trim();
              if (txt.toUpperCase().startsWith(loc.st.toUpperCase() + " -")) {
                stateEl.value = opts[i].value;
                break;
              }
            }
          }

          function searchCriteriaStatusText(extra) {
            const line = "Search criteria: " + String(criteria || "").trim();
            const tail = extra != null && String(extra).length ? String(extra) : "";
            return tail ? line + "\n\n" + tail : line + "\n\n";
          }

          // Print criteria (one line) with blank lines before the next status block.
          showStatus(statusEl, searchCriteriaStatusText(), "info");

          // Run Google name extraction using the criteria (same as Google button).
          if (googleMatchToken) {
            const setGoogleProgress = (pageNum) => {
              const pn = pageNum != null ? String(pageNum) : "?";
              showStatus(
                statusEl,
                searchCriteriaStatusText(
                  "Auto Search: running Google name extraction…\nPage: " + pn
                ),
                "info"
              );
            };
            setGoogleProgress(1);
            try {
              const names = await extractGoogleNamesFromCriteria(googleMatchToken, criteria, (p) => {
                if (p && typeof p.pageNum === "number") setGoogleProgress(p.pageNum);
              });
              if (Array.isArray(names) && nameList) {
                if (names.length) {
                  nameList.value = names.join("\n");
                } else {
                  nameList.value = googleMatchToken || fullName || "";
                  showStatus(
                    statusEl,
                    "Auto Search: Google finished with no extracted names; using lead name for ThatsThem.",
                    "info"
                  );
                }
              }
            } catch (googleErr) {
              if (nameList) nameList.value = googleMatchToken || fullName || "";
              showStatus(
                statusEl,
                "Auto Search: Google extraction failed; using lead name for ThatsThem. " +
                  (googleErr && googleErr.message ? googleErr.message : String(googleErr)),
                "error"
              );
            }
          }

          // After Google finishes populating the names list, run the same matching logic
          // as clicking "Search ThatsThem".
          showStatus(statusEl, "Auto Search: running ThatsThem matching…", "info");
          const phonePatternForSheet =
            ((phonePatternEl && phonePatternEl.value.trim()) || String(rec.phone || "")).trim();
          const mailSettings = await getMailRelaySettings();
          const contactsCtx = {
            rec: rec,
            loc: loc,
            phonePatternForSheet: phonePatternForSheet,
            mailSettings: mailSettings,
            statusEl: statusEl,
            token: null,
            sheetInfo: null,
          };
          const persistQueue = createAutoSearchPersistQueue(contactsCtx);
          const matchResults = await runThatsThemFromUi({
            controlButtons: false,
            persistOnMatch: true,
            contactsCtx: contactsCtx,
            enqueuePersistMatch: persistQueue.enqueue,
          });

          showStatus(statusEl, "Auto Search: finishing Bark_Contacts saves…", "info");
          await persistQueue.flush();

          const matched = (matchResults || []).filter((r) => r && r.matched);
          const saveErrors = persistQueue.getSaveErrors();
          const notPersisted = matched.filter((r) => r.persisted !== true);
          if (notPersisted.length > 0 || saveErrors > 0) {
            showStatus(
              statusEl,
              "Auto Search: " +
                matched.length +
                " match(es); " +
                (matched.length - notPersisted.length) +
                " saved to Bark_Contacts" +
                (saveErrors > 0 ? " (" + saveErrors + " save error(s))" : "") +
                ".",
              saveErrors > 0 ? "error" : "info"
            );
          } else if (matched.length > 0) {
            showStatus(
              statusEl,
              "Auto Search: " + matched.length + " match(es) saved to Bark_Contacts.",
              "success"
            );
          }

          // Update the picked row's Status in the source sheet based on results.
          // Re-resolve row: new leads may have been inserted at the top since we picked.
          let statusResolvedRow = null;
          try {
            const sa3 = await loadServiceAccountJson();
            const token3 = await getServiceAccountAccessToken(sa3);
            const statusValue = matched.length > 0 ? SHEETS_CONFIG.foundValue : SHEETS_CONFIG.notFoundValue;
            const resolved = await findStatusCellRangeForInProgressLead(token3, rec);
            if (!resolved) {
              showStatus(
                statusEl,
                "Auto Search warning: could not find this lead as In progress (sheet changed?). Set Status manually if needed.",
                "error"
              );
            } else {
              await sheetsValuesUpdate(token3, resolved.range, [[statusValue]]);
              statusResolvedRow = resolved.rowNumber;
            }
          } catch (e) {
            showStatus(
              statusEl,
              "Auto Search warning: failed to update Status to Found/No found. " + (e && e.message ? e.message : String(e)),
              "error"
            );
          }

          if (statusResolvedRow != null) {
            showStatus(
              statusEl,
              "Auto Search: finished. Status updated at row " +
                statusResolvedRow +
                " (initial pick was row " +
                res.row +
                ").",
              "success"
            );
          } else {
            showStatus(
              statusEl,
              "Auto Search: finished. Status not updated — initial pick was row " + res.row + ".",
              "success"
            );
          }
        } catch (e) {
          showStatus(statusEl, "Auto Search error: " + (e && e.message ? e.message : String(e)), "error");
        } finally {
          autoSearchRunning = false;
          // If user requested stop while a cycle was running, we stop scheduling
          // but let the cycle complete successfully.
          if (!autoSearchEnabled || stopAfterCurrentCycle) {
            stopAfterCurrentCycle = false;
            autoSearchEnabled = false;
            clearAutoSearchTimeout();
            setOtherButtonsDisabled(false);
            autoSearchSheetBtn.textContent = autoSearchDefaultLabel;
            autoSearchSheetBtn.disabled = false;
            stopCountdown();
          }
        }
      }

      function stopAutoSearch() {
        // Stop scheduling new cycles. If a cycle is currently running,
        // let it finish successfully, then clean up.
        autoSearchEnabled = false;
        clearAutoSearchTimeout();
        hideAutoSearchCountdown();
        if (autoSearchRunning) {
          stopAfterCurrentCycle = true;
          autoSearchSheetBtn.textContent = "Stopping…";
          autoSearchSheetBtn.disabled = true;
          showStatus(statusEl, "Auto Search: will stop after current cycle finishes.", "info");
          return;
        }
        setOtherButtonsDisabled(false);
        autoSearchSheetBtn.textContent = autoSearchDefaultLabel;
        autoSearchSheetBtn.disabled = false;
        stopCountdown();
        showStatus(statusEl, "Auto Search: stopped.", "info");
      }

      autoSearchSheetBtn.addEventListener("click", async function () {
        // Toggle: first click runs immediately then on a configurable interval; second click stops.
        if (autoSearchEnabled) {
          stopAutoSearch();
          return;
        }

        autoSearchEnabled = true;
        stopAfterCurrentCycle = false;
        autoSearchSheetBtn.textContent = "Stop Auto Search";
        setOtherButtonsDisabled(true);
        showStatus(statusEl, "Auto Search enabled (every " + autoSearchIntervalLabel() + ").", "info");

        await runAutoSearchCycle(Date.now());
      });
    }

    searchThatsThemBtn.addEventListener("click", async function () {
      await runThatsThemFromUi({ controlButtons: true });
    });
  });
})();
