import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ModelpatrolError } from "../core/errors.js";
import type { Config } from "../core/model.js";
import { configSchema } from "../core/schemas.js";
import { configPath, resolveHome } from "../infra/paths.js";
import { defaultConfig } from "./defaults.js";

export function loadConfig(home?: string): {
  home: string;
  path: string;
  config: Config;
} {
  const resolvedHome = resolveHome(home);
  const path = configPath(resolvedHome);
  if (!existsSync(path)) {
    return { home: resolvedHome, path, config: defaultConfig() };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ModelpatrolError("CONFIG_INVALID", `${path} is not valid JSON`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ModelpatrolError(
      "CONFIG_INVALID",
      `${path} failed schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return { home: resolvedHome, path, config: parsed.data };
}

export function writeDefaultConfig(home?: string): {
  home: string;
  path: string;
  created: boolean;
  config: Config;
} {
  const resolvedHome = resolveHome(home);
  const path = configPath(resolvedHome);
  mkdirSync(resolvedHome, { recursive: true });
  if (existsSync(path)) {
    return {
      home: resolvedHome,
      path,
      created: false,
      config: loadConfig(resolvedHome).config,
    };
  }
  const config = defaultConfig();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return { home: resolvedHome, path, created: true, config };
}
