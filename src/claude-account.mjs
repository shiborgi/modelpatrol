import { spawn } from "node:child_process";

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// The CLI reports resets as "Sep 7 at 4:19pm (America/Sao_Paulo)" with no
// year, which Date cannot parse. Resolve it in server-local time (the CLI
// reports the account timezone, matching this host) and roll to next year
// when the date already passed. Unparseable text passes through untouched so
// callers render it raw instead of a wrong date.
export function claudeResetISO(text, now = new Date()) {
  const match = String(text ?? "").match(
    /([A-Za-z]{3,9})\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  );
  if (!match) return text ?? null;
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return text;
  let hour = Number(match[3]);
  const minute = Number(match[4] ?? 0);
  const suffix = match[5].toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return text;
  const day = Number(match[2]);
  let date = new Date(now.getFullYear(), month, day, hour, minute, 0);
  if (date <= now)
    date = new Date(now.getFullYear() + 1, month, day, hour, minute, 0);
  return date.toISOString();
}

export function parseClaudeUsageText(value, now = new Date()) {
  const parse = (pattern) => {
    const match = String(value ?? "").match(pattern);
    return match ? { usedPercent: Number(match[1]), resetsAt: claudeResetISO(match[2], now) } : null;
  };
  return {
    session: parse(/Current session:\s*(\d+)% used · resets ([^\n]+)/),
    week: parse(/Current week[^:]*:\s*(\d+)% used · resets ([^\n]+)/),
  };
}

export function claudeUsage() {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "/usage", "--output-format", "json", "--permission-mode", "plan", "--max-turns", "1"], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const out = [], err = [];
    child.stdout.on("data", (chunk) => out.push(chunk)); child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", reject); child.once("close", (code) => {
      if (code) return reject(new Error(Buffer.concat(err).toString() || `Claude exited ${code}`));
      try {
        const data = JSON.parse(Buffer.concat(out).toString());
        if (data.is_error) throw new Error(data.result || "Claude usage query failed");
        const value = data.result ?? "";
        resolve({ ...parseClaudeUsageText(value), fetchedAt: new Date().toISOString() });
      } catch (error) { reject(error); }
    });
    setTimeout(() => child.kill(), 15000).unref();
  });
}
