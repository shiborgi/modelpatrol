import { ModelpatrolError } from "../core/errors.js";

export function flags(args: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--detach" || arg === "--no-browser") {
      map.set(arg, "true");
      continue;
    }
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new ModelpatrolError("USAGE", `missing value for ${arg}`);
      }
      map.set(arg, value);
      i += 1;
    } else {
      throw new ModelpatrolError("USAGE", `unexpected argument: ${arg}`);
    }
  }
  return map;
}

export function optionalHome(opts: Map<string, string>): string | undefined {
  return opts.get("--home");
}
