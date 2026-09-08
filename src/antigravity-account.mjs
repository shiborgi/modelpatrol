import { spawn } from "node:child_process";

const number01 = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
const text = (value) =>
  typeof value === "string" && value.length > 0 ? value : null;

// Parses the structured payload behind the agy /usage slash command. Each
// group (e.g. "Gemini Models", "Claude and GPT models") carries weekly and
// 5-hour buckets with remaining_fraction (0–1) and reset_time. Unknown or
// malformed buckets become null so callers render them as unknown instead
// of estimating quota.
export function parseAgyUsage(output) {
  let reply;
  try {
    reply = JSON.parse(output);
  } catch {
    throw new Error("Invalid Antigravity usage response");
  }
  if (reply?.status !== "SUCCESS" || reply?.command?.name !== "usage")
    throw new Error("Antigravity usage query failed");
  const groups = reply.command.data?.groups;
  if (!Array.isArray(groups) || groups.length === 0)
    throw new Error("Antigravity usage has no limit groups");
  return {
    groups: groups.map((group) => ({
      name: text(group?.name),
      description: text(group?.description),
      buckets: Array.isArray(group?.buckets)
        ? group.buckets.map((bucket) => ({
            id: text(bucket?.id),
            name: text(bucket?.name),
            window: text(bucket?.window),
            remainingFraction: number01(bucket?.remaining_fraction),
            resetTime: text(bucket?.reset_time),
          }))
        : [],
    })),
    fetchedAt: new Date().toISOString(),
  };
}

// Runs /usage headlessly. Slash commands expand in print mode, the command
// resolves without an agent turn (num_turns 0, zero tokens), so polling it
// does not consume subscription quota.
export function agyUsage({ cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "agy",
      ["-p", "/usage", "--output-format", "json", "--mode", "plan", "--model", "gemini-3.8-flash-low"],
      {
        cwd: cwd ?? process.env.MODELPATROL_ANTIGRAVITY_WORKSPACE ?? process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const out = [], err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code)
        return reject(
          new Error(Buffer.concat(err).toString() || `Antigravity exited ${code}`),
        );
      try {
        resolve(parseAgyUsage(Buffer.concat(out).toString()));
      } catch (error) {
        reject(error);
      }
    });
    setTimeout(() => child.kill(), 15000).unref();
  });
}
