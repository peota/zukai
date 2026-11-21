import type { AiConfig } from "./api";

const NAMES = { anthropic: "Anthropic", openai: "OpenAI" } as const;

/** Where a question goes: "Anthropic · <model>", or "<host> · <model>". */
export function providerLabel(config: AiConfig | null): string {
  if (!config) return "AI provider";
  let name: string;
  if (config.provider === "compatible") {
    const url = config.baseUrl?.trim();
    if (!url) name = "AI provider";
    else {
      try {
        name = new URL(url).host || url;
      } catch {
        name = url;
      }
    }
  } else {
    name = NAMES[config.provider];
  }
  return `${name} · ${config.model}`;
}
