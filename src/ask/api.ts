import { Channel, invoke } from "@tauri-apps/api/core";

export type Provider = "anthropic" | "openai" | "compatible";

export interface AiConfig {
  provider: Provider;
  /** Rust sends `null` when there is none. */
  baseUrl?: string | null;
  model: string;
}

export interface AiStatus {
  config: AiConfig | null;
  hasKey: boolean;
  ready: boolean;
  /** Why the keychain couldn't be read; the key then counts as missing. */
  keychainError?: string | null;
}

export type AskEvent =
  | { kind: "text"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export function aiStatus(): Promise<AiStatus> {
  return invoke<AiStatus>("ai_status");
}

export function aiConfigSet(config: AiConfig): Promise<AiStatus> {
  return invoke<AiStatus>("ai_config_set", { config });
}

export function aiKeySet(key: string): Promise<AiStatus> {
  return invoke<AiStatus>("ai_key_set", { key });
}

export function aiKeyRemove(): Promise<AiStatus> {
  return invoke<AiStatus>("ai_key_remove");
}

/** The saved provider's model ids, fetched with the saved key. */
export function aiModels(): Promise<string[]> {
  return invoke<string[]>("ai_models");
}

/** Streams the answer through `onEvent`; `id` names the request for cancel. */
export function aiAsk(
  id: number,
  system: string,
  messages: Message[],
  onEvent: (e: AskEvent) => void,
): Promise<void> {
  const channel = new Channel<AskEvent>();
  channel.onmessage = onEvent;
  return invoke("ai_ask", { id, system, messages, onEvent: channel });
}

export function aiCancel(id: number): Promise<void> {
  return invoke("ai_cancel", { id });
}
