import { useState } from "react";
import type { ReactNode } from "react";
import { aiConfigSet, aiKeyRemove, aiKeySet } from "../ask/api";
import type { AiConfig, AiStatus, Provider } from "../ask/api";
import { BUTTON, Row } from "./SettingsDialog";

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "compatible", label: "OpenAI-compatible (Ollama, LM Studio, …)" },
];

const FIELD =
  "h-7 w-64 rounded-[6px] border border-hairline bg-sunken px-2 text-text outline-none placeholder:text-faint focus:border-accent";

/** A command failure's message (they reject with `{ kind, message }`). */
function messageOf(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 pb-1 text-ui-xs text-red-500">
      {children}
    </p>
  );
}

/** Settings → AI: the AI provider, its model and its key. */
export function AiSettings({
  status,
  onStatus,
}: {
  status: AiStatus;
  onStatus(s: AiStatus): void;
}) {
  const config = status.config;
  const [provider, setProvider] = useState<Provider>(
    config?.provider ?? "anthropic",
  );
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [model, setModel] = useState(config?.model ?? "");
  const [key, setKey] = useState("");
  // A provider picked but not yet confirmed (it forgets the saved key).
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (op: () => Promise<AiStatus>): Promise<boolean> => {
    try {
      onStatus(await op());
      setError(null);
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    }
  };

  /** Saves the config with `next` laid over what's shown, if it changed. */
  const save = async (next: {
    provider?: Provider;
    baseUrl?: string;
    model?: string;
  }) => {
    const p = next.provider ?? provider;
    const url = (next.baseUrl ?? baseUrl).trim();
    const m = (next.model ?? model).trim();
    if (
      config &&
      config.provider === p &&
      (config.baseUrl ?? "") === (p === "compatible" ? url : "") &&
      config.model === m
    ) {
      return;
    }
    const c: AiConfig = { provider: p, model: m };
    if (p === "compatible") c.baseUrl = url;
    await run(() => aiConfigSet(c));
  };

  const applyProvider = async (p: Provider) => {
    setPending(null);
    setProvider(p);
    setBaseUrl("");
    setModel("");
    await save({ provider: p, baseUrl: "", model: "" });
  };

  const pickProvider = (p: Provider) => {
    if (p === provider) return;
    if (status.hasKey) setPending(p);
    else void applyProvider(p);
  };

  const commit = (e: { key: string; currentTarget: HTMLInputElement }) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  const saveKey = async () => {
    if (key === "") return;
    if (await run(() => aiKeySet(key))) setKey("");
  };

  return (
    <div className="flex flex-col">
      <Row label={<label htmlFor="z-ai-provider">Provider</label>}>
        <select
          id="z-ai-provider"
          value={pending ?? provider}
          onChange={(e) => pickProvider(e.target.value as Provider)}
          className={FIELD}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      {pending && (
        <div className="flex items-center gap-2 pb-2 text-muted">
          <span className="flex-1">
            Changing the provider forgets the saved key.
          </span>
          <button
            type="button"
            className={BUTTON}
            onClick={() => void applyProvider(pending)}
          >
            Change provider
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {provider === "compatible" && (
        <Row label={<label htmlFor="z-ai-url">URL</label>}>
          <input
            id="z-ai-url"
            type="text"
            spellCheck={false}
            placeholder="http://localhost:11434/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => void save({})}
            onKeyDown={commit}
            className={FIELD}
          />
        </Row>
      )}
      <Row label={<label htmlFor="z-ai-model">Model</label>}>
        <input
          id="z-ai-model"
          type="text"
          spellCheck={false}
          placeholder={provider === "anthropic" ? "claude-sonnet-5-5" : ""}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => void save({})}
          onKeyDown={commit}
          className={FIELD}
        />
      </Row>
      {status.hasKey ? (
        <Row label="Key">
          <span className="text-muted">Key set</span>
          <button
            type="button"
            className={BUTTON}
            onClick={() => void run(aiKeyRemove)}
          >
            Remove
          </button>
        </Row>
      ) : (
        <Row
          label={
            <label htmlFor="z-ai-key">
              {provider === "compatible" ? "Key (optional)" : "Key"}
            </label>
          }
        >
          <input
            id="z-ai-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveKey();
            }}
            className={FIELD}
          />
          <button
            type="button"
            className={BUTTON}
            disabled={key === ""}
            onClick={() => void saveKey()}
          >
            Save key
          </button>
        </Row>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <p className="m-0 pt-3 text-ui-xs text-faint">
        Ask sends only what you ask about, and only when you press Enter. Hidden
        text is never sent.
      </p>
    </div>
  );
}
