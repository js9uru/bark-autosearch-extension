/**
 * ZabaSearch "Search & Process" — ported from zabasearch-NPD (email pattern matching on zabasearch.com).
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
    if (M && M.filterRows && M.normalizeBarkLocalStars) {
      const norm = M.normalizeBarkLocalStars(pattern);
      return M.filterRows(rows, norm);
    }
    const re = new RegExp(
      "^" + pattern.replace(/([.+?^${}()|[\]\\])/g, "\\$1").replace(/\*/g, ".") + "$",
      "i"
    );
    return (rows || []).filter((s) => typeof s === "string" && re.test(s));
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
        <strong>Data found:</strong> ${payload.data.length > 0 ? payload.data.join(", ") : "None"}
      </div>
    `;
    resultsEl.appendChild(t);
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    const searchZabaBtn = document.getElementById("searchZabaBtn");
    const stopZabaSearch = document.getElementById("stopZabaSearch");
    const firstnameEl = document.getElementById("firstname");
    const emailPatternEl = document.getElementById("emailPattern");
    const cityEl = document.getElementById("city");
    const stateEl = document.getElementById("state");
    const nameList = document.getElementById("nameList");
    const statusEl = document.getElementById("status");
    const resultsEl = document.getElementById("results");

    if (!searchZabaBtn || !nameList) return;

    let stopZaba = false;

    if (stopZabaSearch) {
      stopZabaSearch.addEventListener("click", () => {
        stopZaba = true;
        showStatus(statusEl, "Stopping ZabaSearch…", "info");
      });
    }

    searchZabaBtn.addEventListener("click", async () => {
      const first = (firstnameEl && firstnameEl.value.trim()) || "";
      let pattern = (emailPatternEl && emailPatternEl.value.trim()) || "";
      const city = (cityEl && cityEl.value.trim()) || "";
      const stateSlug = (stateEl && stateEl.value.trim()) || "";
      const lines = nameList.value.split("\n").filter((l) => l.trim());

      if (!first || !stateSlug || lines.length === 0) {
        showStatus(
          statusEl,
          "Please fill first name and state, extract names into the list, then try again.",
          "error"
        );
        return;
      }

      if (pattern) {
        const at = pattern.indexOf("@");
        if (at > 0) {
          const rest = pattern.substring(at);
          pattern = "*".repeat(at) + rest;
        }
      }

      if (!pattern) {
        showStatus(statusEl, "Please enter an email pattern.", "error");
        return;
      }

      stopZaba = false;
      searchZabaBtn.disabled = true;
      searchZabaBtn.style.display = "none";
      if (stopZabaSearch) {
        stopZabaSearch.style.display = "block";
        stopZabaSearch.disabled = false;
      }
      if (resultsEl) resultsEl.innerHTML = "";
      showStatus(statusEl, `ZabaSearch: processing ${lines.length} name(s)…`, "info");

      const results = [];
      for (let i = 0; i < lines.length; i++) {
        if (stopZaba) {
          showStatus(
            statusEl,
            `ZabaSearch stopped. Processed ${i}/${lines.length} names, found ${results.filter((r) => r.matched).length} matches.`,
            "info"
          );
          break;
        }

        const nameLine = lines[i].trim();
        if (!nameLine) continue;

        const stateClean = stateSlug.replace(/[^a-zA-Z0-9]/g, "-");
        const cityClean = city.replace(/[^a-zA-Z0-9]/g, "-");
        const base = `https://www.zabasearch.com/people/${nameLine.replace(" ", "-")}/${stateClean}/`;
        const url = cityClean ? `${base}${cityClean}/` : base;

        showStatus(statusEl, `ZabaSearch ${i + 1}/${lines.length}: ${nameLine}…`, "info");

        try {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "fetchPageData", url }, resolve);
          });
          const raw = (res && res.data) || [];
          const matched = filterByEmailPattern(raw, pattern);
          const row = { name: nameLine, url, data: matched, matched: matched.length > 0 };
          results.push(row);
          if (row.matched) appendResult(resultsEl, row);
        } catch {
          /* next */
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      searchZabaBtn.disabled = false;
      searchZabaBtn.style.display = "block";
      if (stopZabaSearch) stopZabaSearch.style.display = "none";

      const matchedCount = results.filter((r) => r.matched).length;
      const total = results.length;
      if (!stopZaba) {
        showStatus(
          statusEl,
          `ZabaSearch done. Processed ${total} name(s), found ${matchedCount} match(es).`,
          matchedCount ? "success" : "error"
        );
      }
    });
  });
})();
