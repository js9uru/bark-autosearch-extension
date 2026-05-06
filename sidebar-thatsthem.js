/**
 * ThatsThem name search pages — email and/or phone pattern matching (e.g. /name/Kristen-Johnson/Cheshire-CT).
 */
(function () {
  const AUTO_SEARCH_INTERVAL_MINUTES = 2;
  const AUTO_SEARCH_INTERVAL_MS = AUTO_SEARCH_INTERVAL_MINUTES * 60 * 1000;
  const SHEETS_CONFIG = {
    spreadsheetId: "1rfv9DgxPrUuSQI7P5zYzGa3NEloSVnr-j9Fv3k9ndl4",
    sheetTab: "Bark_Leads",
    topN: 150,
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
  };

  function firstToken(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    return t.split(/\s+/)[0] || "";
  }

  function areaCodePrefix(phoneValue) {
    const digits = String(phoneValue || "").replace(/\D/g, "");
    return digits.length >= 3 ? digits.slice(0, 3) + "-" : "";
  }

  function normalizeLocationCityStateZip(locationValue) {
    const raw = String(locationValue || "").trim();
    if (!raw) return { city: "", st: "", zip: "", display: "" };
    const cleaned = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    const m = cleaned.match(/^\s*([^,]+?)\s*,\s*([A-Z]{2})\s*,?\s*(\d{5}(?:-\d{4})?)\b/);
    if (m) {
      const city = (m[1] || "").trim();
      const st = (m[2] || "").trim();
      const zip = (m[3] || "").trim();
      return { city, st, zip, display: `${city}, ${st}, ${zip}` };
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

  function localNowString() {
    const d = new Date();
    // Example: 2026-05-06 00:19 GMT+9 (uses the user's local machine timezone)
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
    return `${yyyy}-${mm}-${dd} ${hh}:${mi} (${tz})`;
  }

  function extractAllEmails(emails) {
    const arr = Array.isArray(emails) ? emails : [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      let v = "";
      if (typeof x === "string") v = x.trim();
      else if (x && typeof x === "object" && x.redacted === true && x.hrefEmail) v = String(x.hrefEmail).trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
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

    // Write header row for Bark_Contacts (no Status).
    const header = [
      "Name",
      "Service",
      "Location",
      "Phone",
      "Email",
      "Verified Phone",
      "Details Q&A",
      "Added At",
    ];
    await sheetsValuesUpdate(token, a1QuoteSheetTitle(SHEETS_CONFIG.contactsTab) + "!A1", [header]);
    return { sheetId: sheetId, created: true };
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

  async function extractGoogleNamesFromCriteria(firstname, criteria, onProgress) {
    const url = googleSearchUrl(criteria);
    const tab = await chrome.tabs.create({ url, active: false });
    const tabId = tab && tab.id;
    if (!tabId) throw new Error("Failed to open Google tab");

    let shouldCloseTab = true;
    let onDone = null;
    let doneTimer = null;
    let progressTimer = null;
    const donePromise = new Promise((resolve) => {
      onDone = (msg) => {
        if (msg && (msg.action === "googleExtractionComplete" || msg.action === "googleExtractionBlocked")) resolve(msg);
      };
      chrome.runtime.onMessage.addListener(onDone);
    });

    try {
      await waitTabComplete(tabId, 45000);

      const sendExtract = async () =>
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(
            tabId,
            { action: "extractNamesGoogle", firstname: String(firstname || "").trim() },
            resolve
          );
        });

      const sendCaptchaStatus = async () =>
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "googleCaptchaStatus" }, resolve);
        });

      // Ask the content script on the Google SERP to extract names (same as the Google button).
      let res = await sendExtract();

      const getTabUrl = async () =>
        await new Promise((resolve) => {
          chrome.tabs.get(tabId, (t) => resolve(t && t.url ? String(t.url) : ""));
        });

      const looksBlockedUrl = (u) => {
        const s = String(u || "");
        return s.includes("google.com/sorry") || s.includes("/sorry/") || s.includes("recaptcha");
      };

      // Manual solve flow: if blocked (or we can't talk to the page yet), keep tab open and wait for user to solve.
      if (!res || (res && res.blocked)) {
        shouldCloseTab = false;
        if (typeof onProgress === "function") onProgress({ blocked: true, pageNum: 1 });
        try {
          await chrome.tabs.update(tabId, { active: true });
        } catch (e) {
          /* ignore */
        }

        const startWait = Date.now();
        const maxWaitMs = 10 * 60 * 1000; // 10 minutes
        while (Date.now() - startWait < maxWaitMs) {
          await new Promise((r) => setTimeout(r, 2000));
          let st = null;
          try {
            st = await sendCaptchaStatus();
          } catch (e) {
            st = null;
          }
          const stillBlocked = st && st.success === true ? st.blocked === true : null;
          const tabUrl = await getTabUrl();

          if (stillBlocked === false || (!looksBlockedUrl(tabUrl) && tabUrl.includes("google.com/search"))) {
            // Solved: restart extraction.
            shouldCloseTab = true;
            res = await sendExtract();
            break;
          }
        }

        if (!res || (res && res.blocked)) {
          throw new Error("Google blocked (captcha/unusual traffic). Timed out waiting for manual solve.");
        }
      }

      if (!res || res.success !== true) throw new Error((res && res.error) || "Google extraction failed");
      if (res.navigating) {
        // Progress updates: read googleExtractionState.pageNum while content script paginates.
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

        // Wait for completion signal from the content script (it paginates all pages).
        // Also keep a fallback poll so we can still return partial names if needed.
        const timeoutMs = 180000; // 3 minutes
        const timeoutPromise = new Promise((resolve) => {
          doneTimer = setTimeout(() => resolve(null), timeoutMs);
        });
        const doneMsg = await Promise.race([donePromise, timeoutPromise]);
        if (doneMsg && doneMsg.action === "googleExtractionBlocked") {
          // Manual solve during pagination (Google redirected to /sorry/).
          shouldCloseTab = false;
          if (typeof onProgress === "function") onProgress({ blocked: true, pageNum: doneMsg.pageNum || null });
          try {
            await chrome.tabs.update(tabId, { active: true });
          } catch (e) {
            /* ignore */
          }

          const startWait = Date.now();
          const maxWaitMs = 10 * 60 * 1000; // 10 minutes
          while (Date.now() - startWait < maxWaitMs) {
            await new Promise((r) => setTimeout(r, 2000));
            let st = null;
            try {
              st = await sendCaptchaStatus();
            } catch (e) {
              st = null;
            }
            const stillBlocked = st && st.success === true ? st.blocked === true : null;
            if (stillBlocked === false) {
              shouldCloseTab = true;
              res = await sendExtract();
              break;
            }
          }
          if (res && res.blocked) {
            throw new Error("Google blocked (captcha/unusual traffic). Timed out waiting for manual solve.");
          }

          // After solve, wait again for completion (with the same overall timeout window).
          const doneMsg2 = await Promise.race([donePromise, timeoutPromise]);
          if (doneMsg2 && Array.isArray(doneMsg2.names)) return doneMsg2.names;
        }
        if (doneMsg && Array.isArray(doneMsg.names)) return doneMsg.names;

        const got = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "getGoogleNames" }, resolve);
        });
        return got && got.success && Array.isArray(got.names) ? got.names : [];
      }
      return Array.isArray(res.names) ? res.names : [];
    } finally {
      try {
        if (doneTimer) clearTimeout(doneTimer);
        if (progressTimer) clearInterval(progressTimer);
        if (onDone) chrome.runtime.onMessage.removeListener(onDone);
      } catch (e) {
        /* ignore */
      }
      // Close the Google tab after extraction is complete (or timeout fallback),
      // so it stays open during crawling but doesn't accumulate tabs.
      try {
        if (shouldCloseTab) await chrome.tabs.remove(tabId);
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

  function notifyContactAdded(opts) {
    try {
      if (!chrome || !chrome.notifications || typeof chrome.notifications.create !== "function") return;
      const name = opts && opts.name ? String(opts.name) : "";
      const emailCount = opts && typeof opts.emailCount === "number" ? opts.emailCount : null;
      const phoneCount = opts && typeof opts.phoneCount === "number" ? opts.phoneCount : null;
      const lines = [];
      if (emailCount != null) lines.push("Emails: " + String(emailCount));
      if (phoneCount != null) lines.push("Phones: " + String(phoneCount));
      const message = lines.length ? lines.join("  •  ") : "Saved to Bark_Contacts";

      chrome.notifications.create(
        "bark_contacts_added_" + String(Date.now()),
        {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icon.png"),
          title: "Bark contact added",
          message: (name ? name + "\n" : "") + message,
          priority: 1,
        },
        () => void 0
      );
    } catch (e) {
      /* ignore */
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
      if (thatsThemRunning) return;
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
            if (row.matched) appendResult(resultsEl, row);
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
      let autoSearchIntervalId = null;
      let countdownIntervalId = null;
      let nextCycleAtMs = null;
      const autoSearchDefaultLabel = autoSearchSheetBtn.textContent || "Auto Search";
      let restoreDisabledState = null;

      function formatCountdown(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        return mm + ":" + ss;
      }

      function startCountdown() {
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        countdownIntervalId = setInterval(() => {
          if (!autoSearchEnabled || autoSearchRunning || !nextCycleAtMs) return;
          const remaining = nextCycleAtMs - Date.now();
          showStatus(statusEl, "Auto Search: next cycle in " + formatCountdown(remaining), "info");
        }, 1000);
      }

      function stopCountdown() {
        if (countdownIntervalId) clearInterval(countdownIntervalId);
        countdownIntervalId = null;
        nextCycleAtMs = null;
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

      async function runAutoSearchCycle() {
        // Non-overlapping: if a previous cycle is still running, skip this tick.
        if (autoSearchRunning || !autoSearchEnabled) return;
        autoSearchRunning = true;
        nextCycleAtMs = null;
        try {
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
          if (firstnameEl) firstnameEl.value = fullName;
          if (cityEl && loc.city) cityEl.value = loc.city;
          if (emailPatternEl && rec.email) emailPatternEl.value = rec.email;
          if (phonePatternEl && rec.phone) phonePatternEl.value = rec.phone;
          if (nameList) nameList.value = rec.name ? rec.name : nameList.value;
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

          // Print criteria before the Google extraction status.
          showStatus(statusEl, "Search criteria:\n" + criteria, "info");

          // Run Google name extraction using the criteria (same as Google button).
          if (googleMatchToken) {
            const setGoogleProgress = (pageNum) => {
              const pn = pageNum != null ? String(pageNum) : "?";
              showStatus(
                statusEl,
                "Search criteria:\n" +
                  criteria +
                  "\n\nAuto Search: running Google name extraction…\nPage: " +
                  pn,
                "info"
              );
            };
            setGoogleProgress(1);
            const names = await extractGoogleNamesFromCriteria(googleMatchToken, criteria, (p) => {
              if (p && typeof p.pageNum === "number") setGoogleProgress(p.pageNum);
            });
            if (Array.isArray(names) && names.length && nameList) {
              nameList.value = names.join("\n");
            }
          }

          // After Google finishes populating the names list, run the same matching logic
          // as clicking "Search ThatsThem".
          showStatus(statusEl, "Auto Search: running ThatsThem matching…", "info");
          const matchResults = await runThatsThemFromUi({ controlButtons: false });

          // If we found any matches, add a row to Bark_Contacts at the top.
          const matched = (matchResults || []).filter((r) => r && r.matched);
          if (matched.length > 0) {
            showStatus(statusEl, "Auto Search: saving to Bark_Contacts…", "info");
            const best = matched[0];
            const allEmails = extractAllEmails(best.data && best.data.emails);
            const allPhones = extractAllPhones(best.data && best.data.phones);
            const phonePatternForSheet =
              ((phonePatternEl && phonePatternEl.value.trim()) || String(rec.phone || "")).trim();
            const phoneCell =
              allPhones.length > 0 ? allPhones.join("\n") : phonePatternForSheet;

            const sa2 = await loadServiceAccountJson();
            const token2 = await getServiceAccountAccessToken(sa2);
            const sheetInfo = await ensureContactsSheet(token2);

            const rowValues = [
              String(best.name || ""),
              String(rec.service || ""),
              String(loc.display || rec.location || ""),
              phoneCell,
              allEmails.join("\n"),
              String(rec.verifiedPhone || ""),
              String(rec.details || ""),
              localNowString(),
            ];
            await insertContactRowAtTop(token2, sheetInfo.sheetId, rowValues);
            notifyContactAdded({
              name: String(best.name || ""),
              emailCount: allEmails.length,
              phoneCount: allPhones.length,
            });
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
            if (autoSearchIntervalId) {
              clearInterval(autoSearchIntervalId);
              autoSearchIntervalId = null;
            }
            setOtherButtonsDisabled(false);
            autoSearchSheetBtn.textContent = autoSearchDefaultLabel;
            autoSearchSheetBtn.disabled = false;
            stopCountdown();
          } else {
            nextCycleAtMs = Date.now() + AUTO_SEARCH_INTERVAL_MS;
          }
        }
      }

      function stopAutoSearch() {
        // Stop scheduling new cycles. If a cycle is currently running,
        // let it finish successfully, then clean up.
        autoSearchEnabled = false;
        if (autoSearchIntervalId) {
          clearInterval(autoSearchIntervalId);
          autoSearchIntervalId = null;
        }
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
        // Toggle behavior:
        // - first click enables interval mode (runs immediately, then every 5 minutes)
        // - second click stops (and requests cancellation if a cycle is mid-flight)
        if (autoSearchEnabled) {
          stopAutoSearch();
          return;
        }

        autoSearchEnabled = true;
        stopAfterCurrentCycle = false;
        autoSearchSheetBtn.textContent = "Stop Auto Search";
        setOtherButtonsDisabled(true);
        showStatus(statusEl, "Auto Search enabled (every 5 minutes).", "info");

        // Run immediately, then every 5 minutes.
        await runAutoSearchCycle();
        nextCycleAtMs = Date.now() + AUTO_SEARCH_INTERVAL_MS;
        startCountdown();
        autoSearchIntervalId = setInterval(function () {
          runAutoSearchCycle();
        }, AUTO_SEARCH_INTERVAL_MS);
      });
    }

    searchThatsThemBtn.addEventListener("click", async function () {
      await runThatsThemFromUi({ controlButtons: true });
    });
  });
})();
