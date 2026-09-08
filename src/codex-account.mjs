import { spawn } from "node:child_process";

export function codexUsage() {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let buffer = "", next = 1, done = false;
    const pending = new Map();
    const finish = (error, value) => { if (done) return; done = true; child.kill(); error ? reject(error) : resolve(value); };
    const call = (method, params = {}) => new Promise((ok, fail) => { const id = next++; pending.set(id, { ok, fail }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`); });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        const request = pending.get(message.id); if (!request) continue;
        pending.delete(message.id); message.error ? request.fail(new Error(message.error.message)) : request.ok(message.result);
      }
    });
    child.once("error", finish);
    (async () => { try {
      await call("initialize", { clientInfo: { name: "modelpatrol", version: "1.0" } });
      child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
      const [limits, usage] = await Promise.all([call("account/rateLimits/read"), call("account/usage/read")]);
      finish(null, { limits, usage, fetchedAt: new Date().toISOString() });
    } catch (error) { finish(error); } })();
    setTimeout(() => finish(new Error("Codex account query timed out")), 15000).unref();
  });
}
