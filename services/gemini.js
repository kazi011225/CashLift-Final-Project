// Uses Node's built-in fetch (Node 18+) - no extra dependency needed.

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Asks Gemini to explain, in plain language, what a donation of a given
 * amount to a given cause could realistically achieve.
 *
 * Returns a string with the explanation, or null if something went wrong
 * (caller decides how to handle that - we never want a Gemini hiccup to
 * block someone from logging their donation).
 */
async function generateImpactText(cause, amount) {
  const prompt = `A user just donated $${amount} to the cause "${cause}" through a donation tracking app.
In 1-2 short sentences, explain in plain, encouraging language what a donation of this size could
realistically help accomplish for this cause, using a concrete, relatable example (e.g. number of meals,
days of clean water, school supplies, etc). Use widely known, approximate real-world cost estimates.
Do not use markdown formatting. Keep it under 40 words.`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Gemini API returned an error:', response.status, errBody);
      return null;
    }

    const data = await response.json();

    // Defensive parsing - the API response is nested, and any of these
    // pieces could theoretically be missing (e.g. if content was blocked).
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.error('Gemini response had no usable text:', JSON.stringify(data));
      return null;
    }

    return text.trim();
  } catch (err) {
    console.error('Gemini request failed:', err);
    return null;
  }
}

module.exports = { generateImpactText };