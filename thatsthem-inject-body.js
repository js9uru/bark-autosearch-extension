() => {
  const emailLike = (s) => {
    const t = String(s || "")
      .trim()
      .replace(/\s+/g, "");
    return /^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$/i.test(t) ? t : null;
  };

  function decodeXHrefMeta(b64) {
    if (!b64 || typeof b64 !== "string") return { email: null, path: null, raw: "" };
    const raw = b64.trim();
    try {
      const path = atob(raw);
      const m = path.match(/([\w.%+-]+@[\w.-]+\.[a-z]{2,})/i);
      return { email: m ? m[1] : null, path, raw };
    } catch (err) {
      return { email: null, path: null, raw: "" };
    }
  }
  function decodeXHref(b64) {
    return decodeXHrefMeta(b64).email;
  }

  function parseRedactedLi(li) {
    const red = li.querySelector('.redacted,span.redacted,[class*="redacted"]');
    if (!red) return null;
    const container = red.parentElement;
    if (!container) return null;
    const st = red.getAttribute("style") || "";
    const rm = st.match(/--length:\s*(\d+)/i);
    const redLen = rm ? parseInt(rm[1], 10) : NaN;
    if (!Number.isFinite(redLen) || redLen < 0) return null;
    let prefix = "";
    for (let n = container.firstChild; n && n !== red; n = n.nextSibling) {
      if (n.nodeType === 3) prefix += n.textContent || "";
      else if (n.nodeType === 1 && n !== red) {
        if (n.contains && n.contains(red)) {
          for (let c = n.firstChild; c && c !== red; c = c.nextSibling) {
            if (c.nodeType === 3) prefix += c.textContent || "";
            else if (c.nodeType === 1 && c !== red && !(c.contains && c.contains(red)))
              prefix += c.textContent || "";
          }
          break;
        }
        prefix += n.textContent || "";
      }
    }
    prefix = prefix.replace(/\s+/g, "").replace(/@.*/, "");
    let after = "";
    for (let n = red.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 3) after += n.textContent || "";
      else if (n.nodeType === 1) after += n.textContent || "";
    }
    const ati = after.indexOf("@");
    if (ati < 0) return null;
    const suffix = after.slice(0, ati).replace(/\s+/g, "");
    const domain = after
      .slice(ati + 1)
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9.-]/gi, "");
    return { redacted: true, prefix, suffix, redactedLen: redLen, domain };
  }

  function findXHrefHost(fromEl) {
    let n = fromEl;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (n.getAttribute && n.getAttribute("x-href")) return n;
    }
    return null;
  }

  function parseRedactedPhoneLi(li) {
    const red = li.querySelector('.redacted,span.redacted,[class*="redacted"]');
    if (!red) return null;
    const container = findXHrefHost(red);
    if (!container) return null;
    const st = red.getAttribute("style") || "";
    const rm = st.match(/--length:\s*(\d+)/i);
    const redLen = rm ? parseInt(rm[1], 10) : NaN;
    if (!Number.isFinite(redLen) || redLen < 0) return null;
    let prefix = "";
    for (let n = container.firstChild; n && n !== red; n = n.nextSibling) {
      if (n.nodeType === 3) prefix += n.textContent || "";
      else if (n.nodeType === 1 && n !== red) {
        if (n.contains && n.contains(red)) {
          for (let c = n.firstChild; c && c !== red; c = c.nextSibling) {
            if (c.nodeType === 3) prefix += c.textContent || "";
            else if (c.nodeType === 1 && c !== red && !(c.contains && c.contains(red)))
              prefix += c.textContent || "";
          }
          break;
        }
        prefix += n.textContent || "";
      }
    }
    prefix = prefix.replace(/\s+/g, "");
    let suffix = "";
    for (let n = red.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 3) suffix += n.textContent || "";
      else if (n.nodeType === 1) suffix += n.textContent || "";
    }
    suffix = suffix.replace(/\s+/g, "");
    let hrefPhone = "";
    try {
      const raw = container.getAttribute("x-href");
      const path = atob(String(raw || "").trim());
      if (/@[\w.-]+\.[a-z]{2,}/i.test(path)) return null;
      const pm = path.match(/\/phone\/([\d-]+)/i);
      if (pm) hrefPhone = pm[1];
    } catch (err) {
      /* ignore */
    }
    return { redacted: true, prefix, suffix, redactedLen: redLen, hrefPhone };
  }

  function formatUs10FromDigits(digits) {
    const d = String(digits || "").replace(/\D/g, "");
    let ten = d;
    if (ten.length === 11 && ten[0] === "1") ten = ten.slice(1);
    if (ten.length !== 10) return null;
    return "(" + ten.slice(0, 3) + ") " + ten.slice(3, 6) + "-" + ten.slice(6);
  }

  function formatFromTelHref(href) {
    const h = String(href || "");
    const m = h.match(/^tel:\s*(.+)/i);
    if (!m) return null;
    return formatUs10FromDigits(m[1]);
  }

  function decodePhoneFromXHref(b64) {
    if (!b64 || typeof b64 !== "string") return null;
    try {
      const path = atob(b64.trim());
      if (/@[\w.-]+\.[a-z]{2,}/i.test(path)) return null;
      const telm = path.match(/tel:([+\d()\s.\-]+)/i);
      if (telm) {
        const f = formatUs10FromDigits(telm[1]);
        if (f) return f;
      }
      const pm = path.match(/\/phone\/([\d-]+)/i);
      if (pm) return pm[1];
      const dig = path.replace(/\D/g, "");
      if (dig.length >= 10) {
        const tail = dig.length > 10 ? dig.slice(-10) : dig;
        return formatUs10FromDigits(tail);
      }
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function sectionRootsUnderHeading(card, needle) {
    const n = needle.toLowerCase();
    const roots = [];
    card.querySelectorAll("h3").forEach(function (h3) {
      const t = (h3.textContent || "").trim().toLowerCase();
      if (t.indexOf(n) < 0) return;
      let el = h3.nextElementSibling;
      for (let i = 0; i < 25 && el; i++, el = el.nextElementSibling) {
        if (/^h[1-6]$/i.test(el.tagName)) break;
        roots.push(el);
      }
    });
    return roots;
  }

  function scrapeEmailsFromRoot(root, addEmail) {
    if (!root) return;
    root.querySelectorAll("[x-href]").forEach((el) => {
      const li = el.closest("li");
      if (
        li &&
        li.querySelector('.redacted,span.redacted,[class*="redacted"]')
      ) {
        return;
      }
      const e = decodeXHref(el.getAttribute("x-href"));
      if (e) addEmail(e);
    });
    root.querySelectorAll("li").forEach((li) => {
      const xEl = li.querySelector("[x-href]");
      const meta = decodeXHrefMeta(xEl && xEl.getAttribute("x-href"));
      const o = parseRedactedLi(li);
      if (o) {
        if (meta.email) o.hrefEmail = meta.email;
        if (meta.raw) o.xHref = meta.raw;
        if (meta.path && !meta.email) o.xHrefDecoded = meta.path;
        addEmail(o);
      } else {
        li.querySelectorAll("[x-href]").forEach((xel) => {
          const e = decodeXHref(xel.getAttribute("x-href"));
          if (e) addEmail(e);
        });
      }
      const a = li.querySelector("a[href^='mailto:']");
      if (a) {
        let m = a.href.replace(/^mailto:/i, "").split("?")[0];
        try {
          m = decodeURIComponent(m);
        } catch (err) {}
        const y = emailLike(m);
        if (y) addEmail(y);
      }
    });
  }

  function scrapePhonesFromRoot(root, addPhone) {
    if (!root) return;
    root.querySelectorAll('a[href^="tel:"]').forEach((a) => {
      const href = a.getAttribute("href") || "";
      const fromHref = formatFromTelHref(href);
      if (fromHref) addPhone(fromHref);
      const txt = (a.textContent || "").trim().replace(/\s+/g, " ");
      if (txt && /[\d*]/.test(txt) && txt.length >= 8) addPhone(txt);
    });
    root.querySelectorAll("li").forEach((li) => {
      const o = parseRedactedPhoneLi(li);
      if (o) {
        addPhone(o);
        return;
      }
      const hasRed = li.querySelector('.redacted,span.redacted,[class*="redacted"]');
      if (hasRed) return;
      li.querySelectorAll("[x-href]").forEach((el) => {
        const ph = decodePhoneFromXHref(el.getAttribute("x-href"));
        if (ph) addPhone(ph);
      });
    });
  }

  function dedupeEmailsList(emailsOut) {
    const hrefSet = new Set();
    for (const x of emailsOut) {
      if (x && x.redacted === true && x.hrefEmail) {
        hrefSet.add(String(x.hrefEmail).trim().toLowerCase());
      }
    }
    return emailsOut.filter((x) => {
      if (typeof x !== "string") return true;
      const t = x.trim().toLowerCase();
      return !hrefSet.has(t);
    });
  }

  function collectCard(card) {
    const emails = [];
    const phones = [];
    const seenE = new Set();
    const seenP = new Set();
    const addEmail = (x) => {
      const k = typeof x === "string" ? x : JSON.stringify(x);
      if (seenE.has(k)) return;
      seenE.add(k);
      emails.push(x);
    };
    const addPhone = (x) => {
      const k = typeof x === "string" ? x.toLowerCase() : JSON.stringify(x);
      if (seenP.has(k)) return;
      seenP.add(k);
      phones.push(x);
    };
    const emailRoots = sectionRootsUnderHeading(card, "email");
    const phoneRoots = sectionRootsUnderHeading(card, "phone");
    emailRoots.forEach(function (r) {
      scrapeEmailsFromRoot(r, addEmail);
    });
    phoneRoots.forEach(function (r) {
      scrapePhonesFromRoot(r, addPhone);
    });
    return { emails: dedupeEmailsList(emails), phones: phones };
  }

  function legacyGlobalScrape() {
    const emailsOut = [];
    const phonesOut = [];
    const seenE = new Set();
    const seenP = new Set();
    const addEmail = (x) => {
      const k = typeof x === "string" ? x : JSON.stringify(x);
      if (seenE.has(k)) return;
      seenE.add(k);
      emailsOut.push(x);
    };
    const addPhone = (x) => {
      const k = typeof x === "string" ? x.toLowerCase() : JSON.stringify(x);
      if (seenP.has(k)) return;
      seenP.add(k);
      phonesOut.push(x);
    };
    const main = document.querySelector("main") || document.body;
    document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      const title = (h.textContent || "").trim().toLowerCase();
      if (!title.includes("email")) return;
      let el = h.nextElementSibling;
      for (let i = 0; i < 20 && el; i++, el = el.nextElementSibling) {
        if (/^h[1-6]$/i.test(el.tagName)) break;
        scrapeEmailsFromRoot(el, addEmail);
      }
    });
    document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      const title = (h.textContent || "").trim().toLowerCase();
      if (!title.includes("phone")) return;
      let el = h.nextElementSibling;
      for (let i = 0; i < 20 && el; i++, el = el.nextElementSibling) {
        if (/^h[1-6]$/i.test(el.tagName)) break;
        scrapePhonesFromRoot(el, addPhone);
      }
    });
    scrapeEmailsFromRoot(main, addEmail);
    scrapePhonesFromRoot(main, addPhone);
    if (emailsOut.length === 0) {
      const bad = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]),
        re = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi;
      function walk(el) {
        if (!el || bad.has(el.tagName)) return;
        for (const ch of el.childNodes) {
          if (ch.nodeType === 3) {
            let m;
            const r2 = new RegExp(re.source, "gi");
            while ((m = r2.exec(ch.textContent || "")) !== null) addEmail(m[0]);
          } else if (ch.nodeType === 1) walk(ch);
        }
      }
      walk(main);
    }
    return {
      emails: dedupeEmailsList(emailsOut),
      phones: phonesOut,
    };
  }

  const main = document.querySelector("main") || document.body;
  const records = Array.from(main.querySelectorAll("div.record")).filter(function (el) {
    return el.classList && el.classList.contains("record");
  });

  if (records.length === 0) {
    const leg = legacyGlobalScrape();
    return { cards: [{ emails: leg.emails, phones: leg.phones }] };
  }

  const cards = records.map(function (card) {
    return collectCard(card);
  });

  return { cards: cards };
}
