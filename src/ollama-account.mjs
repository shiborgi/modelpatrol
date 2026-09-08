const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

// Queries the account that owns OLLAMA_API_KEY. The endpoint is the same one
// the Ollama web settings page reads: limits.session/weekly.usage are
// allowance fractions (0–1) for the rolling 5-hour session and 7-day weekly
// windows of legacy credit plans. Reset timestamps are not exposed, so
// callers must render resets as unknown rather than estimating them.
export async function ollamaUsage(apiKey, { fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("Ollama Cloud API key is not configured");
  const response = await fetchImpl("https://ollama.com/api/usage", {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Ollama usage query failed (${response.status})`);
  const data = await response.json();
  return {
    session: { usedFraction: number(data?.limits?.session?.usage) },
    weekly: { usedFraction: number(data?.limits?.weekly?.usage) },
    fetchedAt: new Date().toISOString(),
  };
}
