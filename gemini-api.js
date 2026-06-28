/**
 * Google Gemini API — generateContent for gemini-3.1-flash-lite.
 * API key: Settings field `apiKey` in chrome.storage.local
 */
(function (global) {
  const DEFAULT_MODEL = "gemini-3.1-flash-lite";
  const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
  const DEFAULT_TIMEOUT_MS = 120000;

  function getStoredApiKey() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(["apiKey"], function (o) {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(String((o && o.apiKey) || "").trim());
      });
    });
  }

  function normalizeGeminiModel(model) {
    let m = String(model || "").trim();
    if (!m) return DEFAULT_MODEL;
    if (m.indexOf("models/") === 0) m = m.slice("models/".length);
    if (/^gpt-/i.test(m) || /^o\d/i.test(m) || /^text-davinci/i.test(m)) return DEFAULT_MODEL;
    if (m === "gemini-2.5-flash" || m === "gemini-2.0-flash") return DEFAULT_MODEL;
    return m || DEFAULT_MODEL;
  }

  function getStoredModel() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(["nameExtractionModel"], function (o) {
        resolve(normalizeGeminiModel(o && o.nameExtractionModel));
      });
    });
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
      '". Ignore any middle names, initials, prefixes, or suffixes.\n' +
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
    const apiKey = options.apiKey ? String(options.apiKey).trim() : await getStoredApiKey();
    if (!apiKey) return { names: [], error: "Gemini API key not set in Settings" };

    const model = options.model
      ? normalizeGeminiModel(options.model)
      : await getStoredModel();
    const timeoutMs =
      options.timeoutMs != null ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

    try {
      const content = await Promise.race([
        generateContent({
          apiKey: apiKey,
          model: model,
          systemInstruction: nameExtractionSystemPrompt(firstname),
          userText: pageText,
          temperature: 0,
          thinkingBudget: 0,
          responseMimeType: "application/json",
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
    getStoredApiKey: getStoredApiKey,
    generateContent: generateContent,
    parseJsonFromText: parseJsonFromText,
    extractNamesFromText: extractNamesFromText,
    nameExtractionSystemPrompt: nameExtractionSystemPrompt,
  };
})(typeof self !== "undefined" ? self : window);
