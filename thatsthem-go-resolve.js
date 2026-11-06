importScripts("email-pattern-match.js", "phone-pattern-match.js");

function ttValueFromUrl(finalUrl) {
  if (!finalUrl) return null;
  let path = "";
  try {
    path = new URL(finalUrl).pathname || "";
  } catch (err) {
    return null;
  }
  path = path.replace(/\/+$/, "");
  const em = path.match(/\/email\/(.+)$/i);
  if (em) {
    let email = em[1];
    try {
      email = decodeURIComponent(email);
    } catch (err) {}
    email = String(email || "").replace(/\s+/g, "");
    if (email.indexOf("@") < 0) return null;
    return { email: email };
  }
  const ph = path.match(/\/phone\/(.+)$/i);
  if (ph) {
    let phone = ph[1];
    try {
      phone = decodeURIComponent(phone);
    } catch (err) {}
    phone = String(phone || "").trim();
    if (!phone) return null;
    return { phone: phone };
  }
  return null;
}

async function ttOpenGo(goUrl) {
  const url = String(goUrl || "");
  if (!/^https:\/\/thatsthem\.com\/go\//i.test(url)) return "";
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: url, active: false });
  } catch (err) {
    return "";
  }
  const started = Date.now();
  let finalUrl = "";
  try {
    while (Date.now() - started < 12000) {
      let info = null;
      try {
        info = await chrome.tabs.get(tab.id);
      } catch (err) {
        break;
      }
      const current = (info && (info.url || info.pendingUrl)) || "";
      if (/\/email\/|\/phone\//i.test(current)) {
        finalUrl = current;
        break;
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, 200);
      });
    }
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (err) {}
  }
  return finalUrl;
}

async function ttResolveRows(rows, kind, cache) {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!row || typeof row !== "object" || !row.goUrl) continue;
    if (kind === "email" && row.hrefEmail) continue;
    if (kind === "phone" && row.hrefPhone) continue;
    if (!Object.prototype.hasOwnProperty.call(cache, row.goUrl)) {
      cache[row.goUrl] = await ttOpenGo(row.goUrl);
    }
    const found = ttValueFromUrl(cache[row.goUrl]);
    if (!found) continue;
    if (kind === "email" && found.email) row.hrefEmail = found.email;
    if (kind === "phone" && found.phone) row.hrefPhone = found.phone;
  }
}

function ttFilterRows(rows, kind, pattern) {
  const list = Array.isArray(rows) ? rows : [];
  const pat = String(pattern || "").trim();
  if (!pat) return list;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    let ok = false;
    if (kind === "email") {
      const matcher = typeof EmailPatternMatch !== "undefined" ? EmailPatternMatch : null;
      ok = !!(matcher && matcher.rowMatches && matcher.rowMatches(pat, row));
    } else {
      const matcher = typeof PhonePatternMatch !== "undefined" ? PhonePatternMatch : null;
      ok = !!(matcher && matcher.rowMatchesPhone && matcher.rowMatchesPhone(pat, row));
    }
    if (ok) out.push(row);
  }
  return out;
}

async function ttResolveGo(data, emailPattern, phonePattern) {
  if (!data || !Array.isArray(data.cards)) return data;
  const emailPat = String(emailPattern || "").trim();
  const phonePat = String(phonePattern || "").trim();
  const cache = {};
  for (let i = 0; i < data.cards.length; i++) {
    const card = data.cards[i] || {};
    const emailHits = emailPat ? ttFilterRows(card.emails, "email", emailPat) : [];
    if (emailPat) await ttResolveRows(emailHits, "email", cache);
    if (emailPat && emailHits.length === 0) continue;
    const phoneHits = phonePat ? ttFilterRows(card.phones, "phone", phonePat) : card.phones || [];
    if (emailPat || phonePat) await ttResolveRows(phoneHits, "phone", cache);
  }
  return data;
}
