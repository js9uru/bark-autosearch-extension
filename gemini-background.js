/** Gemini API proxy (content scripts must not call generativelanguage.googleapis.com directly). */
importScripts("gemini-api.js");

async function handleGeminiExtractNames(msg) {
  const apiKey = String((msg && msg.apiKey) || "").trim() || (await GeminiApi.getStoredApiKey());
  return GeminiApi.extractNamesFromText(msg.pageText, msg.firstname, {
    model: msg.model,
    apiKey: apiKey,
  });
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== "geminiExtract") return;
  port.onMessage.addListener(function (msg) {
    if (!msg || msg.action !== "geminiExtractNames") return;
    handleGeminiExtractNames(msg)
      .then(function (result) {
        try {
          port.postMessage({
            success: !result.error,
            names: result.names || [],
            error: result.error || null,
          });
        } catch (e) {
          /* port may be disconnected */
        }
      })
      .catch(function (e) {
        try {
          port.postMessage({
            success: false,
            names: [],
            error: e && e.message ? e.message : String(e),
          });
        } catch (e2) {
          /* ignore */
        }
      });
  });
});

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg.action === "geminiGenerateContent") {
    (async function () {
      try {
        const apiKey =
          String((msg && msg.apiKey) || "").trim() || (await GeminiApi.getStoredApiKey());
        const text = await GeminiApi.generateContent({
          apiKey: apiKey,
          model: msg.model,
          systemInstruction: msg.systemInstruction,
          userText: msg.userText,
          temperature: msg.temperature,
          responseMimeType: msg.responseMimeType,
        });
        sendResponse({ success: true, text: text });
      } catch (e) {
        sendResponse({
          success: false,
          error: e && e.message ? e.message : String(e),
        });
      }
    })();
    return true;
  }
});

importScripts("background.js");
