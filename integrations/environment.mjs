export function harnessSettings(env = process.env) {
  if (!env.MODELPATROL_BASE_URL)
    throw new Error("CodePatrol ModelPatrol environment is missing");
  const base = new URL(env.MODELPATROL_BASE_URL);
  if (
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
    ) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid gateway URL");
  const headers = JSON.parse(env.MODELPATROL_HEADERS ?? "{}");
  if (!headers || typeof headers !== "object" || Array.isArray(headers))
    throw new Error("Invalid metadata headers");
  for (const [key, value] of Object.entries(headers)) {
    if (
      !/^x-patrol-[a-z-]+$/.test(key) ||
      typeof value !== "string" ||
      !/^[A-Za-z0-9_.:/, -]{1,256}$/.test(value)
    )
      throw new Error("Invalid metadata header");
  }
  const key = env[env.MODELPATROL_API_KEY_ENV ?? "MODELPATROL_API_KEY"];
  if (!key) throw new Error("Missing ModelPatrol API key");
  return {
    baseUrl: env.MODELPATROL_BASE_URL.replace(/\/$/, ""),
    model: env.MODELPATROL_MODEL ?? "auto",
    api: env.MODELPATROL_API ?? "chat",
    headers,
    key,
  };
}
