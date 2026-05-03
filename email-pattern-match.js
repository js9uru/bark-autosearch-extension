/**
 * Email pattern: * matches exactly one character; full local + domain lengths must match.
 * Supports ThatsThem-style redacted rows: { redacted, prefix, suffix, redactedLen, domain }.
 */
(function (global) {
  function splitPattern(pattern) {
    const p = String(pattern || "").trim();
    const at = p.indexOf("@");
    if (at < 0) return null;
    return { local: p.slice(0, at), domain: p.slice(at + 1) };
  }

  function wildcardSegmentEqual(patternSeg, valueSeg) {
    if (patternSeg.length !== valueSeg.length) return false;
    for (let i = 0; i < patternSeg.length; i++) {
      const pc = patternSeg[i];
      const vc = valueSeg[i];
      if (pc === "*") continue;
      if (pc.toLowerCase() !== vc.toLowerCase()) return false;
    }
    return true;
  }

  /** Bark-style: replace entire local with * × length so matching is domain-led. */
  function normalizeBarkLocalStars(pattern) {
    const p = String(pattern || "").trim();
    const at = p.indexOf("@");
    if (at <= 0) return p;
    return "*".repeat(at) + p.slice(at);
  }

  function matchFullEmail(pattern, email) {
    const parts = splitPattern(pattern);
    if (!parts) return false;
    const e = String(email || "").trim();
    const at = e.indexOf("@");
    if (at < 0) return false;
    const el = e.slice(0, at);
    const ed = e.slice(at + 1);
    return wildcardSegmentEqual(parts.local, el) && wildcardSegmentEqual(parts.domain, ed);
  }

  /**
   * Redacted: inferred local length = prefix.length + redactedLen + suffix.length (suffix = visible between redacted block and @).
   * Visible indices must match pattern (non-*). Indices inside the redacted run are not checked (length-only).
   */
  function matchRedactedRow(pattern, o) {
    const parts = splitPattern(pattern);
    if (!parts || !o || o.redacted !== true) return false;

    const prefix = String(o.prefix || "");
    const suffix = String(o.suffix || "");
    const domain = String(o.domain || "");
    const redLen = Number(o.redactedLen);
    if (!Number.isFinite(redLen) || redLen < 0) return false;

    const inferredLocalLen = prefix.length + redLen + suffix.length;
    if (inferredLocalLen !== parts.local.length) return false;

    const redStart = prefix.length;
    const redEnd = prefix.length + redLen;

    for (let i = 0; i < inferredLocalLen; i++) {
      if (i >= redStart && i < redEnd) continue;
      const pc = parts.local[i];
      let ch;
      if (i < prefix.length) ch = prefix[i];
      else ch = suffix[i - redEnd];
      if (pc === "*") continue;
      if (pc.toLowerCase() !== ch.toLowerCase()) return false;
    }

    return wildcardSegmentEqual(parts.domain, domain);
  }

  function rowMatches(pattern, row) {
    if (!pattern) return false;
    if (typeof row === "string") return matchFullEmail(pattern, row);
    if (row && row.redacted === true) return matchRedactedRow(pattern, row);
    return false;
  }

  function filterRows(rows, pattern) {
    return (rows || []).filter(function (r) {
      return rowMatches(pattern, r);
    });
  }

  function formatRowForDisplay(row) {
    if (typeof row === "string") return row;
    if (row && row.redacted === true) {
      return row.prefix + "(+" + row.redactedLen + ")@" + row.domain;
    }
    return String(row);
  }

  global.EmailPatternMatch = {
    splitPattern: splitPattern,
    matchFullEmail: matchFullEmail,
    matchRedactedRow: matchRedactedRow,
    rowMatches: rowMatches,
    filterRows: filterRows,
    formatRowForDisplay: formatRowForDisplay,
    normalizeBarkLocalStars: normalizeBarkLocalStars,
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
