import { harnessSettings } from "./environment.mjs";

/** OpenCode 1.x plugin. Use one harness process per CodePatrol stage. */
export default async function modelpatrolPlugin() {
  const settings = harnessSettings();
  const packages = {
    chat: "@ai-sdk/openai-compatible",
    responses: "@ai-sdk/openai",
    messages: "@ai-sdk/anthropic",
  };
  if (!packages[settings.api]) throw new Error("Unsupported ModelPatrol API");
  return {
    config: async (config) => {
      config.provider ??= {};
      config.provider.modelpatrol = {
        npm: packages[settings.api],
        name: "ModelPatrol",
        options: {
          baseURL: `${settings.baseUrl}/v1`,
          apiKey: settings.key,
          headers: {
            ...settings.headers,
            authorization: `Bearer ${settings.key}`,
          },
        },
        models: { [settings.model]: { name: `ModelPatrol ${settings.model}` } },
      };
      config.model = `modelpatrol/${settings.model}`;
      config.small_model = config.model;
    },
    "chat.headers": async (input, output) => {
      if (input.model?.providerID !== "modelpatrol") return;
      Object.assign(output.headers, settings.headers);
    },
  };
}
