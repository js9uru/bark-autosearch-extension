/**
 * ThatsThem name search pages — email pattern matching (e.g. /name/Kristen-Johnson/Cheshire-CT).
 */
(function () {
  function showStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = "status " + kind;
    el.style.display = "block";
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

  function appendResult(resultsEl, payload) {
    if (!resultsEl || !payload) return;
    const t = document.createElement("div");
    t.className = "result-item " + (payload.matched ? "matched" : "");
    t.innerHTML = `
      <div class="result-name">
        <a href="${payload.url}" target="_blank" rel="noopener noreferrer">${payload.name}</a>
      </div>
      <div class="result-data">
        <strong>Data found:</strong> ${
          payload.data.length > 0
            ? payload.data
                .map(function (r) {
                  return typeof EmailPatternMatch !== "undefined" && EmailPatternMatch.formatRowForDisplay
                    ? EmailPatternMatch.formatRowForDisplay(r)
                    : String(r);
                })
                .join(", ")
            : "None"
        }
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
      let pattern = (emailPatternEl && emailPatternEl.value.trim()) || "";
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

      if (!pattern) {
        showStatus(statusEl, "Please enter an email pattern.", "error");
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
          const raw = (res && res.data) || [];
          const matched = filterByEmailPattern(raw, pattern);
          const row = { name: nameLine, url: url, data: matched, matched: matched.length > 0 };
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
