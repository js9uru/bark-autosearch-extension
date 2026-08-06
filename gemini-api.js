/**
 * Google Gemini API — generateContent for gemini-3.1-flash-lite.
 * API keys: `geminiApiKeys` + `geminiApiKeyIndex` in chrome.storage.local
 * (legacy single `apiKey` is migrated on read).
 */
(function (global) {
  const DEFAULT_MODEL = "gemini-3.1-flash-lite";
  const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
  const DEFAULT_TIMEOUT_MS = 120000;
  const STORAGE_KEYS = {
    keys: "geminiApiKeys",
    index: "geminiApiKeyIndex",
    legacy: "apiKey",
  };

  function storageGetLocal(keys) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(keys, function (o) {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(o || {});
      });
    });
  }

  function storageSetLocal(obj) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.set(obj, function () {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  function normalizeApiKeys(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < raw.length; i++) {
      const k = String(raw[i] || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }

  function isGeminiUsageLimitError(msg) {
    const s = String(msg || "").toLowerCase();
    if (!s) return false;
    return (
      /429/.test(s) ||
      /resource_exhausted/.test(s) ||
      /rate limit/.test(s) ||
      /quota exceeded/.test(s) ||
      /exceeded your (current )?quota/.test(s) ||
      /too many requests/.test(s) ||
      /generaterequestsperday/.test(s) ||
      /generaterequestsperminute/.test(s) ||
      /perdayperproject/.test(s) ||
      /perminuteperproject/.test(s)
    );
  }

  function normalizeGeminiModel(model) {
    let m = String(model || "").trim();
    if (!m) return DEFAULT_MODEL;
    if (m.indexOf("models/") === 0) m = m.slice("models/".length);
    if (/^gpt-/i.test(m) || /^o\d/i.test(m) || /^text-davinci/i.test(m)) return DEFAULT_MODEL;
    return m || DEFAULT_MODEL;
  }

  function getStoredModel() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(["nameExtractionModel"], function (o) {
        resolve(normalizeGeminiModel(o && o.nameExtractionModel));
      });
    });
  }

  async function readKeyPoolState() {
    const o = await storageGetLocal([STORAGE_KEYS.keys, STORAGE_KEYS.index, STORAGE_KEYS.legacy]);
    let keys = normalizeApiKeys(o[STORAGE_KEYS.keys]);
    const legacy = String(o[STORAGE_KEYS.legacy] || "").trim();
    if (!keys.length && legacy) keys = [legacy];
    let idx = parseInt(o[STORAGE_KEYS.index], 10);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (keys.length && idx >= keys.length) idx = 0;
    return { keys: keys, activeIndex: idx, legacyKey: legacy };
  }

  async function syncLegacyApiKey(keys, activeIndex) {
    const idx = keys.length ? Math.max(0, Math.min(activeIndex, keys.length - 1)) : 0;
    const activeKey = keys[idx] || "";
    await storageSetLocal({
      [STORAGE_KEYS.keys]: keys,
      [STORAGE_KEYS.index]: idx,
      [STORAGE_KEYS.legacy]: activeKey,
    });
    return { keys: keys, activeIndex: idx, activeKey: activeKey };
  }

  async function getStoredApiKeys() {
    const state = await readKeyPoolState();
    return state.keys;
  }

  async function getActiveApiKeyIndex(keys) {
    const state = await readKeyPoolState();
    const list = keys || state.keys;
    if (!list.length) return 0;
    let idx = state.activeIndex;
    if (idx < 0 || idx >= list.length) idx = 0;
    return idx;
  }

  async function getStoredApiKey() {
    const state = await readKeyPoolState();
    if (!state.keys.length) return "";
    return state.keys[state.activeIndex] || state.keys[0] || "";
  }

  async function setGeminiApiKeys(keys, activeIndex) {
    const normalized = normalizeApiKeys(keys);
    const idx =
      normalized.length && typeof activeIndex === "number" && Number.isFinite(activeIndex)
        ? Math.max(0, Math.min(activeIndex, normalized.length - 1))
        : 0;
    return syncLegacyApiKey(normalized, idx);
  }

  async function setActiveApiKeyIndex(index) {
    const state = await readKeyPoolState();
    if (!state.keys.length) return state;
    const idx = Math.max(0, Math.min(index, state.keys.length - 1));
    return syncLegacyApiKey(state.keys, idx);
  }

  async function advanceToNextApiKey() {
    const state = await readKeyPoolState();
    if (state.keys.length <= 1) {
      return {
        advanced: false,
        exhausted: true,
        index: state.activeIndex,
        total: state.keys.length,
        activeKey: state.keys[state.activeIndex] || "",
      };
    }
    const next = state.activeIndex + 1;
    if (next >= state.keys.length) {
      return {
        advanced: false,
        exhausted: true,
        index: state.activeIndex,
        total: state.keys.length,
        activeKey: state.keys[state.activeIndex] || "",
      };
    }
    const synced = await syncLegacyApiKey(state.keys, next);
    return {
      advanced: true,
      exhausted: false,
      index: synced.activeIndex,
      total: synced.keys.length,
      activeKey: synced.activeKey,
    };
  }

  function nameExtractionSystemPrompt(firstname) {
    const token = String(firstname || "");
    return (
      "You are an expert at extracting first and last names from plain text.\n" +
      'Given a block of text and the value "' +
      token +
      '", perform the following steps, returning only the required JSON (do not include code blocks or extra explanation):\n' +
      "1. Find all unique combinations of first and last names where either the first name or last name exactly matches \"" +
      token +
      '". Consider common nicknames, diminutives, abbreviations, and formal versions of first names as equivalent' +
      ". Ignore any middle names, initials, prefixes, or suffixes.\n" +
      '2. Standardize each result to "First Last" format (do not include middle names).\n' +
      '3. Output the result as: {"names": ["First Last", ...]}\n' +
      'Return only the JSON object as your output, with no surrounding text or formatting. If there are no matches, return {"names": []}'
    );
  }

  function extractAnswerText(data) {
    const parts =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts;
    if (!parts || !parts.length) return "";

    const answer = parts.filter(function (p) {
      return p && typeof p.text === "string" && p.text.trim();
    });
    if (answer.length) {
      for (let i = answer.length - 1; i >= 0; i--) {
        const t = answer[i].text.trim();
        if (t.indexOf("{") >= 0 && t.indexOf("names") >= 0) return t;
      }
      return answer[answer.length - 1].text;
    }

    return "";
  }

  async function generateContent(opts) {
    const apiKey = String((opts && opts.apiKey) || "").trim();
    if (!apiKey) throw new Error("Gemini API key not set in Settings");

    const model = normalizeGeminiModel((opts && opts.model) || DEFAULT_MODEL);
    const url =
      GEMINI_API_BASE +
      "/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    const body = {
      contents: [{ parts: [{ text: String((opts && opts.userText) || "") }] }],
    };

    if (opts && opts.systemInstruction) {
      body.systemInstruction = { parts: [{ text: String(opts.systemInstruction) }] };
    }
    if (opts && opts.temperature != null) {
      body.generationConfig = { temperature: opts.temperature };
    }
    if (opts && opts.thinkingBudget === 0) {
      body.generationConfig = body.generationConfig || {};
      body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    if (opts && opts.responseMimeType) {
      body.generationConfig = body.generationConfig || {};
      body.generationConfig.responseMimeType = opts.responseMimeType;
    }
    if (opts && opts.maxOutputTokens != null) {
      body.generationConfig = body.generationConfig || {};
      body.generationConfig.maxOutputTokens = opts.maxOutputTokens;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errText = "Gemini request failed (" + res.status + ")";
      try {
        const errBody = await res.json();
        if (errBody && errBody.error && errBody.error.message) errText = errBody.error.message;
      } catch (e) {
        /* ignore */
      }
      throw new Error(errText);
    }

    const data = await res.json();
    const text = extractAnswerText(data);
    if (!String(text).trim()) {
      const reason =
        data &&
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].finishReason;
      throw new Error("Gemini returned empty response" + (reason ? " (" + reason + ")" : ""));
    }
    return text;
  }

  async function generateContentWithKeyRotation(opts) {
    const options = opts || {};
    const explicitKey = String(options.apiKey || "").trim();
    if (explicitKey) {
      return generateContent(options);
    }

    const state = await readKeyPoolState();
    if (!state.keys.length) throw new Error("Gemini API key not set in Settings");

    let startIdx = state.activeIndex;
    let lastError = null;

    for (let i = startIdx; i < state.keys.length; i++) {
      try {
        const text = await generateContent(Object.assign({}, options, { apiKey: state.keys[i] }));
        if (i !== startIdx) await syncLegacyApiKey(state.keys, i);
        return text;
      } catch (e) {
        lastError = e;
        const msg = e && e.message ? e.message : String(e);
        if (isGeminiUsageLimitError(msg) && i < state.keys.length - 1) {
          await syncLegacyApiKey(state.keys, i + 1);
          continue;
        }
        throw e;
      }
    }

    throw lastError || new Error("All Gemini API keys have reached their usage limit");
  }

  function parseJsonFromText(content) {
    let text = String(content || "").trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    const brace = text.match(/\{[\s\S]*\}/);
    if (brace) text = brace[0];
    return JSON.parse(text);
  }

  async function extractNamesFromText(pageText, firstname, opts) {
    const options = opts || {};
    const model = options.model
      ? normalizeGeminiModel(options.model)
      : await getStoredModel();
    const timeoutMs =
      options.timeoutMs != null ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

    try {
      const content = await Promise.race([
        generateContentWithKeyRotation({
          apiKey: options.apiKey,
          model: model,
          systemInstruction: nameExtractionSystemPrompt(firstname),
          userText: pageText,
          temperature: 0,
          thinkingBudget: 0,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
        }),
        new Promise(function (_, reject) {
          setTimeout(function () {
            reject(new Error("Gemini timeout"));
          }, timeoutMs);
        }),
      ]);
      const parsed = parseJsonFromText(content);
      return { names: Array.isArray(parsed.names) ? parsed.names : [] };
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      console.warn("Gemini name extraction failed", e);
      return { names: [], error: message };
    }
  }

  global.GeminiApi = {
    DEFAULT_MODEL: DEFAULT_MODEL,
    STORAGE_KEYS: STORAGE_KEYS,
    isGeminiUsageLimitError: isGeminiUsageLimitError,
    normalizeApiKeys: normalizeApiKeys,
    getStoredApiKeys: getStoredApiKeys,
    getActiveApiKeyIndex: getActiveApiKeyIndex,
    getStoredApiKey: getStoredApiKey,
    setGeminiApiKeys: setGeminiApiKeys,
    setActiveApiKeyIndex: setActiveApiKeyIndex,
    advanceToNextApiKey: advanceToNextApiKey,
    readKeyPoolState: readKeyPoolState,
    generateContent: generateContent,
    generateContentWithKeyRotation: generateContentWithKeyRotation,
    parseJsonFromText: parseJsonFromText,
    extractNamesFromText: extractNamesFromText,
    nameExtractionSystemPrompt: nameExtractionSystemPrompt,
  };
})(typeof self !== "undefined" ? self : window);
