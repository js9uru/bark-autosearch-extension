() => {
  const out = [];
  const seen = new Set();
  const add = (x) => {
    const k = typeof x === "string" ? x : JSON.stringify(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  };
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
      return { email: null, path: null, raw };
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
  function scrapeFromRoot(root) {
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
      if (e) add(e);
    });
    root.querySelectorAll("li").forEach((li) => {
      const xEl = li.querySelector("[x-href]");
      const meta = decodeXHrefMeta(xEl && xEl.getAttribute("x-href"));
      const o = parseRedactedLi(li);
      if (o) {
        if (meta.email) o.hrefEmail = meta.email;
        if (meta.raw) o.xHref = meta.raw;
        if (meta.path && !meta.email) o.xHrefDecoded = meta.path;
        add(o);
      } else {
        li.querySelectorAll("[x-href]").forEach((xel) => {
          const e = decodeXHref(xel.getAttribute("x-href"));
          if (e) add(e);
        });
      }
      const a = li.querySelector("a[href^='mailto:']");
      if (a) {
        let m = a.href.replace(/^mailto:/i, "").split("?")[0];
        try {
          m = decodeURIComponent(m);
        } catch (err) {}
        const y = emailLike(m);
        if (y) add(y);
      }
    });
  }
  const main = document.querySelector("main") || document.body;
  document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    const title = (h.textContent || "").trim().toLowerCase();
    if (!title.includes("email")) return;
    let el = h.nextElementSibling;
    for (let i = 0; i < 20 && el; i++, el = el.nextElementSibling) {
      if (/^h[1-6]$/i.test(el.tagName)) break;
      scrapeFromRoot(el);
    }
  });
  scrapeFromRoot(main);
  if (out.length === 0) {
    const bad = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]),
      re = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi;
    function walk(el) {
      if (!el || bad.has(el.tagName)) return;
      for (const ch of el.childNodes) {
        if (ch.nodeType === 3) {
          let m;
          const r2 = new RegExp(re.source, "gi");
          while ((m = r2.exec(ch.textContent || "")) !== null) add(m[0]);
        } else if (ch.nodeType === 1) walk(ch);
      }
    }
    walk(main);
  }
  const hrefSet = new Set();
  for (const x of out) {
    if (x && x.redacted === true && x.hrefEmail) {
      hrefSet.add(String(x.hrefEmail).trim().toLowerCase());
    }
  }
  const deduped = out.filter((x) => {
    if (typeof x !== "string") return true;
    const t = x.trim().toLowerCase();
    return !hrefSet.has(t);
  });
  return deduped;
}
