() => {
  function isCaptchaPage() {
    if (
      document.querySelector(
        '.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], #captcha-container'
      )
    ) {
      return true;
    }
    const text = (document.body?.innerText || "").toLowerCase();
    return (
      text.includes("verify you are human") ||
      text.includes("checking your browser") ||
      text.includes("just a moment")
    );
  }

  function isResultsReady() {
    if (document.readyState !== "complete") return false;
    const body = document.body;
    if (!body || !body.innerText) return false;
    const h1 = document.querySelector("h1");
    return (
      !!(h1 && /results\s+for/i.test(h1.textContent || "")) &&
      (body.innerText.includes("@") || /\d[\d\s().*\-]{8,}/.test(body.innerText))
    );
  }

  function isResolved() {
    const token = document.querySelector('input[name="cf-turnstile-response"]');
    if (token && token.value) return true;
    return isResultsReady();
  }

  function tryClickWrapper() {
    const selectors = [".cf-turnstile", "#captcha-container", "[data-sitekey]"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        return true;
      }
    }
    return false;
  }

  function getClickTarget() {
    tryClickWrapper();

    const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    if (iframe) {
      const rect = iframe.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          x: Math.round(rect.left + 28),
          y: Math.round(rect.top + rect.height / 2),
        };
      }
    }

    const wrap = document.querySelector(".cf-turnstile, #captcha-container, [data-sitekey]");
    if (wrap) {
      const rect = wrap.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          x: Math.round(rect.left + 28),
          y: Math.round(rect.top + rect.height / 2),
        };
      }
    }

    return null;
  }

  return {
    isCaptchaPage: isCaptchaPage(),
    resolved: isResolved(),
    resultsReady: isResultsReady(),
    clickTarget: getClickTarget(),
  };
}
