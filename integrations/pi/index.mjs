import { harnessSettings } from "../environment.mjs";

/** Pi provider extension; selection is explicit through ModelPatrol. */
export default function modelpatrolExtension(pi) {
  const settings = harnessSettings();
  const apis = {
    chat: "openai-completions",
    responses: "openai-responses",
    messages: "anthropic-messages",
  };
  if (!apis[settings.api]) throw new Error("Unsupported ModelPatrol API");
  pi.registerProvider("modelpatrol", {
    baseUrl:
      settings.api === "messages" ? settings.baseUrl : `${settings.baseUrl}/v1`,
    apiKey: settings.key,
    api: apis[settings.api],
    headers: { ...settings.headers, authorization: `Bearer ${settings.key}` },
    models: [
      {
        id: settings.model,
        name: `ModelPatrol ${settings.model}`,
        reasoning: false,
        input: ["text"],
        contextWindow: 32768,
        maxTokens: 4096,
        // Pi requires numeric rates. ModelPatrol remains the accounting source.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
}
