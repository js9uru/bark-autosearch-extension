/**
 * Phone pattern: * matches one digit when using NANP-style patterns like (909) ***-****.
 * Punctuation/spacing in the pattern is ignored for matching; the value is reduced to 10 digits.
 * If the pattern does not resolve to exactly 10 digit/* positions, falls back to
 * character-by-character match on whitespace-normalized strings (legacy).
 * Redacted rows: { redacted, hrefPhone? } — hrefPhone is matched as a normal phone string.
 */
(function (global) {
  function normalizeSpaces(s) {
    return String(s || "").trim().replace(/\s+/g, " ");
  }

  function wildcardEqual(patternSeg, valueSeg) {
    if (patternSeg.length !== valueSeg.length) return false;
    for (let i = 0; i < patternSeg.length; i++) {
      const pc = patternSeg[i];
      const vc = valueSeg[i];
      if (pc === "*") continue;
      if (pc.toLowerCase() !== vc.toLowerCase()) return false;
    }
    return true;
  }

  /** US 10-digit string, or null */
  function digitsOnly10(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.length === 11 && d[0] === "1") d = d.slice(1);
    if (d.length !== 10) return null;
    return d;
  }

  /**
   * Collect only 0-9 and * from the pattern in order. Example: "(909) ***-****" -> "909*******"
   */
  function patternToDigitMask(pattern) {
    const p = String(pattern || "");
    let mask = "";
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === "*") mask += "*";
      else if (/\d/.test(c)) mask += c;
    }
    return mask;
  }

  function matchPhonePatternDigitMask(mask, digits) {
    if (mask.length !== 10 || !digits || digits.length !== 10) return false;
    for (let i = 0; i < 10; i++) {
      const m = mask[i];
      if (m === "*") continue;
      if (m !== digits[i]) return false;
    }
    return true;
  }

  function matchPhonePattern(pattern, phone) {
    const p = String(pattern || "").trim();
    const v = String(phone || "").trim();
    if (!p || !v) return false;

    const mask = patternToDigitMask(p);
    const digits = digitsOnly10(v);
    if (mask.length === 10 && digits) {
      return matchPhonePatternDigitMask(mask, digits);
    }

    const pn = normalizeSpaces(p);
    const vn = normalizeSpaces(v);
    return wildcardEqual(pn, vn);
  }

  function matchPhoneRedactedRow(pattern, o) {
    if (!pattern || !o || o.redacted !== true) return false;
    const href = o.hrefPhone != null ? String(o.hrefPhone).trim() : "";
    if (href) return matchPhonePattern(pattern, href);
    return false;
  }

  function rowMatchesPhone(pattern, row) {
    if (!pattern) return false;
    if (typeof row === "string") return matchPhonePattern(pattern, row);
    if (row && row.redacted === true) return matchPhoneRedactedRow(pattern, row);
    return false;
  }

  function filterPhoneRows(rows, pattern) {
    if (!pattern) return [];
    const p = String(pattern).trim();
    return (rows || []).filter(function (r) {
      return rowMatchesPhone(p, r);
    });
  }

  /** @deprecated use filterPhoneRows */
  function filterPhones(rows, pattern) {
    return filterPhoneRows(rows, pattern);
  }

  function formatPhoneRowForDisplay(row) {
    if (typeof row === "string") return row;
    if (row && row.redacted === true) {
      const page = row.prefix + "(+" + row.redactedLen + ")" + (row.suffix || "");
      const full = row.hrefPhone ? " \u2192 " + row.hrefPhone : "";
      return page + full;
    }
    return String(row);
  }

  global.PhonePatternMatch = {
    matchPhonePattern: matchPhonePattern,
    matchPhonePatternDigitMask: matchPhonePatternDigitMask,
    patternToDigitMask: patternToDigitMask,
    digitsOnly10: digitsOnly10,
    matchPhoneRedactedRow: matchPhoneRedactedRow,
    rowMatchesPhone: rowMatchesPhone,
    filterPhoneRows: filterPhoneRows,
    filterPhones: filterPhones,
    formatPhoneRowForDisplay: formatPhoneRowForDisplay,
    normalizeSpaces: normalizeSpaces,
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
