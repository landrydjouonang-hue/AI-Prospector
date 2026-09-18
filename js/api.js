// api.js - thin wrapper around the OpenRouter chat completions API
// (OpenAI-compatible). Runs inside the extension's background service
// worker (has host permission for openrouter.ai). The API key is supplied
// by the user and stored only in chrome.storage.local - it never leaves
// the browser except in requests made directly to OpenRouter.

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

/**
 * Calls a model via OpenRouter, optionally with its web-search plugin enabled.
 * @param {string} apiKey OpenRouter API key
 * @param {string} model OpenRouter model slug, e.g. "anthropic/claude-sonnet-4.5", "openai/gpt-4o-mini"
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} opts { useWebSearch: bool, maxTokens: number }
 * @returns {Promise<{text: string, raw: object}>}
 */
export async function callModel(apiKey, model, systemPrompt, userPrompt, opts = {}) {
  const { useWebSearch = false, maxTokens = 2000 } = opts;

  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens,
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  // OpenRouter's web-search plugin: attaches live search results (via Exa)
  // to the conversation before the model responds. Works across models.
  if (useWebSearch) {
    body.plugins = [{ id: "web", max_results: 6 }];
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://prospector-extension.local",
      "X-Title": "AI Prospector - HSE & Agency Lead Finder"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    throw new Error(`OpenRouter API error (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text: text.trim(), raw: data };
}

/**
 * Extracts the first valid JSON value (array or object) found in a string,
 * tolerating stray prose or ```json fences around it.
 */
export function extractJson(text) {
  const cleaned = text.replace(/```json/gi, "```").trim();
  const fenceMatch = cleaned.match(/```([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : cleaned;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBracket = Math.min(
      ...["[", "{"].map((c) => {
        const i = candidate.indexOf(c);
        return i === -1 ? Infinity : i;
      })
    );
    const lastBracket = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
    if (firstBracket !== Infinity && lastBracket !== -1 && lastBracket > firstBracket) {
      const slice = candidate.slice(firstBracket, lastBracket + 1);
      return JSON.parse(slice);
    }
    throw new Error("Could not parse JSON from model response");
  }
}

export const DEFAULT_OPENROUTER_MODEL = DEFAULT_MODEL;
