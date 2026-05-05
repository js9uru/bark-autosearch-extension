/**
 * ThatsThem name search pages — email and/or phone pattern matching (e.g. /name/Kristen-Johnson/Cheshire-CT).
 */
(function () {
  const SHEETS_CONFIG = {
    spreadsheetId: "1rfv9DgxPrUuSQI7P5zYzGa3NEloSVnr-j9Fv3k9ndl4",
    sheetTab: "test",
    topN: 100,
    statusColName: "Status",
    todoValue: "Todo",
    inProgressValue: "In progress",
    nameColName: "Name",
    locationColName: "Location",
    phoneColName: "Phone",
    emailColName: "Email",
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
    };
    return { picked: true, row: pickedRowNumber, range: cellRange, record: rec };
  }

  function showStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = "status " + kind;
    el.style.display = "block";
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

    if (stopThatsThemSearch) {
      stopThatsThemSearch.addEventListener("click", function () {
        stopThatsThem = true;
        showStatus(statusEl, "Stopping ThatsThem…", "info");
      });
    }

    if (autoSearchSheetBtn) {
      autoSearchSheetBtn.addEventListener("click", async function () {
        autoSearchSheetBtn.disabled = true;
        try {
          showStatus(statusEl, "Auto Search: checking Google Sheet for Todo…", "info");
          const res = await pickFirstTodoAndMarkInProgress();
          if (!res.picked) {
            showStatus(statusEl, "Auto Search: " + res.reason, "error");
            return;
          }
          const rec = res.record || {};
          const loc = normalizeLocationCityStateZip(rec.location);
          const criteria = `${firstToken(rec.name)} living in ${loc.display || rec.location}; ${areaCodePrefix(rec.phone)}`;

          // Fill sidebar fields so you can run Search ThatsThem immediately.
          if (firstnameEl) firstnameEl.value = firstToken(rec.name);
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
          showStatus(
            statusEl,
            "Auto Search: picked row " + res.row + " (Status → In progress). Criteria: " + criteria,
            "success"
          );
        } catch (e) {
          showStatus(statusEl, "Auto Search error: " + (e && e.message ? e.message : String(e)), "error");
        } finally {
          autoSearchSheetBtn.disabled = false;
        }
      });
    }

    searchThatsThemBtn.addEventListener("click", async function () {
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
        return;
      }

      if (!emailPattern && !phonePattern) {
        showStatus(statusEl, "Please enter an email pattern and/or a phone pattern.", "error");
        return;
      }

      stopThatsThem = false;
      searchThatsThemBtn.disabled = true;
      searchThatsThemBtn.style.display = "none";
      if (stopThatsThemSearch) {
        stopThatsThemSearch.style.display = "block";
        stopThatsThemSearch.disabled = false;
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

      searchThatsThemBtn.disabled = false;
      searchThatsThemBtn.style.display = "block";
      if (stopThatsThemSearch) stopThatsThemSearch.style.display = "none";

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
    });
  });
})();
