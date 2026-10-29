// Strict parsing for Wrangler D1 --json output. Wrangler may print non-JSON
// diagnostics around the JSON payload, so the parser extracts and validates
// the structured result instead of assuming the whole stdout is JSON.
export function parseWranglerD1Json(stdout) {
  const text = String(stdout ?? "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) throw new Error("WRANGLER_JSON_INVALID");
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error("WRANGLER_JSON_INVALID");
    }
  }
  const results = Array.isArray(parsed) ? parsed : parsed?.result;
  if (!Array.isArray(results) || results.length === 0 ||
      results.some((entry) => entry?.success !== true))
    throw new Error("WRANGLER_D1_RESULT_INVALID");
  return results;
}
