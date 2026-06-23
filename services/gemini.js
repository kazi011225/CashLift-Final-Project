// Uses Node's built-in fetch (Node 18+) - no extra dependency needed.

// Try the primary model first. If it's overloaded (503), fall back to a
// second model rather than leaving the user with no impact text at all.
const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-2.0-flash'];

const MAX_RETRIES_PER_MODEL = 2;
const RETRY_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(cause, amount) {
  return `A user just donated $${amount} to the cause "${cause}" through a donation tracking app.
In 1-2 short sentences, explain in plain, encouraging language what a donation of this size could
realistically help accomplish for this cause, using a concrete, relatable example (e.g. number of meals,
days of clean water, school supplies, etc). Use widely known, approximate real-world cost estimates.
Do not use markdown formatting. Do not use dashes or hyphens of any kind, including em dashes,
en dashes, or hyphens, write in plain sentences instead. Keep it under 40 words.`;
}

/**
 * Makes a single request to a given Gemini model.
 * Returns { text } on success, or { error, status } on failure.
 * Never throws - all failure modes are returned as data so the caller
 * can decide whether to retry, fall back, or give up.
 */
async function callGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      return { error: errBody, status: response.status };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return { error: `No usable text in response: ${JSON.stringify(data)}`, status: 200 };
    }

    return { text: text.trim() };
  } catch (err) {
    return { error: err.message, status: null };
  }
}

/**
 * Asks Gemini to explain, in plain language, what a donation of a given
 * amount to a given cause could realistically achieve.
 *
 * Tries each model in MODELS_TO_TRY in order, retrying transient failures
 * (like 503 "overloaded") a couple of times before moving to the next model.
 *
 * Returns a string with the explanation, or null if every attempt failed
 * (caller decides how to handle that - a Gemini outage should never block
 * someone from logging their donation).
 */
async function generateImpactText(cause, amount) {
  const prompt = buildPrompt(cause, amount);

  for (const model of MODELS_TO_TRY) {
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      const result = await callGemini(model, prompt);

      if (result.text) {
        return result.text;
      }

      console.error(
        `Gemini call failed (model: ${model}, attempt: ${attempt}/${MAX_RETRIES_PER_MODEL}, status: ${result.status}):`,
        result.error
      );

      // Only worth retrying on "temporarily overloaded" - a bad API key or
      // malformed request will just fail the same way every time.
      const isRetryable = result.status === 503 || result.status === 429;
      const hasRetriesLeft = attempt < MAX_RETRIES_PER_MODEL;

      if (isRetryable && hasRetriesLeft) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      break; // move on to the next model (if any)
    }
  }

  console.error('All Gemini models failed - falling back to no impact text for this donation.');
  return null;
}

module.exports = { generateImpactText };