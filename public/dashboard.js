const $ = (id) => document.getElementById(id);
$("sidebar-toggle").onclick = () => {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  $("sidebar-toggle").setAttribute("aria-expanded", String(!collapsed));
};
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
function table(target, headers, rows) {
  const element = document.createElement("table");
  const head = element.createTHead().insertRow();
  headers.forEach((value) => {
    const cell = document.createElement("th");
    cell.textContent = value;
    head.append(cell);
  });
  const body = element.createTBody();
  rows.forEach((row) => {
    const tr = body.insertRow();
    row.forEach((value) => {
      const cell = tr.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value ?? "Unknown";
    });
  });
  $(target).replaceChildren(element);
}
const money = (n) => `$${Number(n).toFixed(5)}`;
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function toDate(value, now = new Date()) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value >= 1e12 ? value : value * 1000);
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return null;
    if (/^\d+(\.\d+)?$/.test(text)) {
      const num = Number(text);
      return new Date(num >= 1e12 ? num : num * 1000);
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (match) {
      let hour = Number(match[1]);
      const minute = Number(match[2] ?? 0);
      const suffix = (match[3] ?? "").toLowerCase();
      if (suffix === "pm" && hour < 12) hour += 12;
      if (suffix === "am" && hour === 12) hour = 0;
      if (hour > 23 || minute > 59) return null;
      const candidate = new Date(now);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
      return candidate;
    }
    return null;
  }
  return null;
}
function fmtProviderDate(value) {
  const date = toDate(value);
  if (date) return dateFmt.format(date).replace(",", "");
  return typeof value === "string" && value.trim() !== "" ? value : "Not reported";
}
const fmtPct = (percent) => `${String(parseFloat(Number(percent).toFixed(1)))}%`;
function usageCell(percent, reset) {
  const date = toDate(reset);
  if (percent === null || percent === undefined) return date ? fmtProviderDate(reset) : "Not reported";
  const wrap = document.createElement("div");
  wrap.className = "usage-cell";
  const row = document.createElement("div");
  row.className = "usage-row";
  const bar = document.createElement("div");
  bar.className = "usage-bar";
  const fill = document.createElement("div");
  fill.className = "usage-fill" + (percent >= 90 ? " critical" : percent >= 70 ? " warning" : "");
  fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  bar.append(fill);
  const label = document.createElement("span");
  label.className = "usage-pct";
  label.textContent = fmtPct(percent);
  row.append(bar, label);
  wrap.append(row);
  if (date) {
    const when = document.createElement("span");
    when.className = "usage-reset";
    when.textContent = fmtProviderDate(reset);
    wrap.append(when);
  }
  return wrap;
}
function limitCell(limit) {
  if (!limit) return "Not reported";
  return usageCell(
    limit.usedFraction === null || limit.usedFraction === undefined
      ? null
      : limit.usedFraction * 100,
    limit.resetsAt,
  );
}
function limitsByPeriod(limits = []) {
  const session = limits.find((limit) =>
    /session|primary|5h|hour/i.test(limit.id),
  ) ?? limits.find((limit) => limit.window === "rolling") ?? null;
  const week = limits.find((limit) =>
    /week|secondary|credit/i.test(limit.id),
  ) ?? limits.find((limit) => limit.window === "calendar") ?? null;
  return { session, week };
}
function agyGroup(usage, modelId) {
  const groups = usage?.groups ?? [];
  if (!groups.length) return null;
  const tokens = String(modelId ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  let best = groups[0], bestScore = 0;
  for (const group of groups) {
    const haystack = `${group.name ?? ""} ${group.description ?? ""}`.toLowerCase();
    const score = tokens.reduce((n, token) => n + (haystack.includes(token) ? 1 : 0), 0);
    if (score > bestScore) { best = group; bestScore = score; }
  }
  return best;
}
const demo = new URLSearchParams(location.search).has("demo");
const demoMetrics = { groups: [
  { key: "codex/coder", requests: 48, inputTokens: 182400, outputTokens: 31800, cacheReadTokens: 96000, costUsd: 1.284, unknownCost: 0, errors: 1, p95Ms: 2410, averageTtftMs: 640 },
  { key: "anthropic/sonnet", requests: 31, inputTokens: 112700, outputTokens: 22400, cacheReadTokens: 42000, costUsd: .918, unknownCost: 2, errors: 0, p95Ms: 3180, averageTtftMs: 820 },
  { key: "ollama-cloud/coder", requests: 19, inputTokens: 73400, outputTokens: 11600, cacheReadTokens: 0, costUsd: 0, unknownCost: 19, errors: 2, p95Ms: 1890, averageTtftMs: 410 },
], sampledRequests: 98, monthlyCostUsd: 2.202, budgetUsd: 25 };
const demoRequests = [
  { id: "demo-9c21f4a0", time: new Date(Date.now() - 420000).toISOString(), model: "codex/coder", metadata: { step: "build", agent: "developer" }, reason: "rule:implementation", status: "ok", costUsd: .0312, attempts: [{ model: "codex/coder", status: 200 }] },
  { id: "demo-17a8d020", time: new Date(Date.now() - 930000).toISOString(), model: "anthropic/sonnet", metadata: { step: "build-review", agent: "qa" }, reason: "rule:review", status: "ok", costUsd: .0224, attempts: [{ model: "anthropic/sonnet", status: 200 }] },
  { id: "demo-5e103b9d", time: new Date(Date.now() - 1560000).toISOString(), model: "ollama-cloud/coder", metadata: { step: "plan", agent: "architect" }, reason: "default", status: "error", costUsd: null, attempts: [{ model: "ollama-cloud/coder", status: 503 }, { model: "grok/coder", status: 200 }] },
];
const demoProviders = { providers: [
  { id: "anthropic", configured: true, plan: { name: "Anthropic API" } }, { id: "codex", configured: true, plan: { name: "OpenAI API — Codex" } }, { id: "ollama-cloud", configured: true, plan: { name: "Ollama Cloud Pro", monthlyUsd: 20 } }, { id: "grok", configured: false, plan: { name: "xAI API" } }, { id: "opencode-go", configured: false, plan: { name: "OpenCode Go" } },
] };
function filters() {
  const query = new URLSearchParams({ groupBy: $("group").value });
  for (const id of ["from", "to"])
    if ($(id).value) query.set(id, new Date($(id).value).toISOString());
  if ($("run").value) query.set("run-id", $("run").value);
  return query;
}
async function refresh() {
  try {
    if (demo) {
      $("mode-badge").textContent = "DEMO PREVIEW · NO API"; $("status").textContent = "Synthetic data · no credentials required";
      const sum = (field) => demoMetrics.groups.reduce((n, row) => n + row[field], 0);
      $("cards").replaceChildren(...[["Requests", sum("requests")], ["Tokens reported", (sum("inputTokens") + sum("outputTokens")).toLocaleString()], ["Estimated spend", money(sum("costUsd"))], ["Unknown cost", sum("unknownCost")]].map(([label, value]) => { const el = document.createElement("div"); el.className = "card"; const caption = document.createElement("span"); caption.textContent = label; const number = document.createElement("strong"); number.textContent = value; el.append(caption, number); return el; }));
      $("coverage").textContent = `Synthetic preview with ${demoMetrics.sampledRequests} requests. Month spend: ${money(demoMetrics.monthlyCostUsd)}. Budget: ${money(demoMetrics.budgetUsd)}.`;
      table("metrics", ["Group", "Calls", "Input", "Output", "Cache read", "Cost", "Unknown cost", "Errors", "p95 ms", "TTFB ms"], demoMetrics.groups.map((r) => [r.key, r.requests, r.inputTokens, r.outputTokens, r.cacheReadTokens, money(r.costUsd), r.unknownCost, r.errors, r.p95Ms, r.averageTtftMs.toFixed(0)]));
      table("request-table", ["Time", "Model", "Step", "Agent", "Route", "Status", "Cost", "Inspect"], demoRequests.map((r) => { const button = document.createElement("button"); button.textContent = r.id.slice(0, 8); button.onclick = () => { $("detail").textContent = JSON.stringify(r, null, 2); }; return [fmtProviderDate(r.time), r.model, r.metadata.step, r.metadata.agent, r.reason, r.status, r.costUsd === null ? "Unknown" : money(r.costUsd), button]; }));
      table("usage-table", ["Provider", "Session", "Week"], [["Codex", usageCell(62, Date.now() / 1000 + 4 * 3600), usageCell(38, Date.now() + 5 * 86400 * 1000)], ["Claude", usageCell(45, Date.now() + 3 * 3600 * 1000), usageCell(21, Date.now() + 4 * 86400 * 1000)], ["Ollama Cloud", usageCell(0, null), usageCell(0.1, null)], ["Grok", usageCell(null, null), usageCell(100, Date.now() + 86400 * 1000)], ["Antigravity", usageCell(0, Date.now() + 5 * 3600 * 1000), usageCell(0, Date.now() + 7 * 86400 * 1000)], ["OpenCode Go", "Not reported", "Not reported"]]);
      return;
    }
    const query = filters();
    const [metrics, requests] = await Promise.all([
      api(`/admin/metrics?${query}`),
      api(`/admin/requests?${query}`),
    ]);
    const catalog = await api("/admin/providers").catch(() => null);
    const harnessUsage = await Promise.all(
      (catalog?.providers ?? []).filter((provider) =>
        provider.usage || provider.plan?.kind === "subscription",
      ).map(async (provider) => ({
        provider: provider.id,
        usage: await api(`/admin/providers/${encodeURIComponent(provider.id)}/usage`).catch(() => null),
      })),
    );
    const sum = (field) => metrics.groups.reduce((n, row) => n + row[field], 0);
    $("cards").replaceChildren(
      ...[
        ["Requests", sum("requests")],
        [
          "Tokens reported",
          (sum("inputTokens") + sum("outputTokens")).toLocaleString(),
        ],
        ["Estimated spend", money(sum("costUsd"))],
        ["Unknown cost", sum("unknownCost")],
      ].map(([label, value]) => {
        const el = document.createElement("div");
        el.className = "card";
        const caption = document.createElement("span");
        caption.textContent = label;
        const number = document.createElement("strong");
        number.textContent = value;
        el.append(caption, number);
        return el;
      }),
    );
    $("coverage").textContent =
      `Latest ${metrics.sampledRequests} matching requests (maximum ${metrics.maxRequests}). Month spend: ${money(metrics.monthlyCostUsd)}. Budget: ${metrics.budgetUsd === null ? "Not configured" : money(metrics.budgetUsd)}.`;
    table(
      "metrics",
      [
        "Group",
        "Calls",
        "Input",
        "Output",
        "Cache read",
        "Cost",
        "Unknown cost",
        "Errors",
        "p95 ms",
        "TTFB ms",
      ],
      metrics.groups.map((r) => [
        r.key,
        r.requests,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        money(r.costUsd),
        r.unknownCost,
        r.errors,
        r.p95Ms,
        r.averageTtftMs?.toFixed(0),
      ]),
    );
    table(
      "request-table",
      ["Time", "Model", "Step", "Agent", "Route", "Status", "Cost", "Inspect"],
      requests.data.map((r) => {
        const button = document.createElement("button");
        button.textContent = r.id.slice(0, 8);
        button.onclick = () => {
          $("detail").textContent = JSON.stringify(r, null, 2);
        };
        return [
          fmtProviderDate(r.time),
          r.model,
          r.metadata.step,
          r.metadata.agent,
          r.reason,
          r.status,
          r.costUsd === null ? "Unknown" : money(r.costUsd),
          button,
        ];
      }),
    );
    const rows = harnessUsage.map(({ provider, usage }) => {
      if (!usage || usage.status === "unavailable")
        return [provider, "Not reported", "Not reported"];
      const limits = limitsByPeriod(usage.limits);
      return [provider, limitCell(limits.session), limitCell(limits.week)];
    });
    table("usage-table", ["Provider", "Session", "Week"], rows);
    $("status").textContent = `Atualizado em ${fmtProviderDate(new Date().toISOString())}`;
  } catch (error) {
    $("status").textContent = error.message;
  }
}
$("filters").onsubmit = (event) => {
  event.preventDefault();
  refresh();
};
refresh();
$("export").onclick = async () => {
  try {
    const response = await fetch(`/admin/export?${filters()}`);
    if (!response.ok) throw new Error(`Export failed (${response.status})`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelpatrol.ndjson";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    $("status").textContent = error.message;
  }
};
