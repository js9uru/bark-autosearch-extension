/**
 * ThatsThem name search pages — email and/or phone pattern matching (e.g. /name/Kristen-Johnson/Cheshire-CT).
 */
(function () {
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
