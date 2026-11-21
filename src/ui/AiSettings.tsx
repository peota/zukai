import { useState } from "react";
import type { ReactNode } from "react";
import { aiConfigSet, aiKeyRemove, aiKeySet } from "../ask/api";
import { ANTHROPIC_DEFAULT_MODEL } from "../ask/defaults";
import type { AiConfig, AiStatus, Provider } from "../ask/api";
import { BUTTON, Row } from "./settingsRows";

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
    <p role="alert" className="m-0 pb-1 text-ui-xs text-danger">
      {children}
    </p>
  );
}

/** What a saved config still lacks before Ask can be used, if anything. */
function missing(status: AiStatus): string | null {
  const c = status.config;
  if (!c || status.ready) return null;
  if (c.provider === "compatible") {
    if (!c.baseUrl?.trim()) return "Enter the server URL to use Ask.";
  } else if (!status.hasKey) {
    return null;
  }
  if (c.provider !== "anthropic" && !c.model.trim()) {
    return "Enter a model to use Ask.";
  }
  return null;
}

/** A change that forgets the saved key, until it's confirmed or cancelled. */
type Pending = { kind: "provider"; provider: Provider } | { kind: "url" };

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
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showStored = () => {
    setProvider(config?.provider ?? "anthropic");
    setBaseUrl(config?.baseUrl ?? "");
    setModel(config?.model ?? "");
  };

  // The fields follow the stored config when it changes.
  const stored = JSON.stringify([
    config?.provider,
    config?.baseUrl ?? "",
    config?.model,
  ]);
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setPending(null);
    showStored();
  }

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
  const save = async (
    next: { provider?: Provider; baseUrl?: string; model?: string },
    confirmed = false,
  ) => {
    // Nothing that forgets the key goes out while its confirm is open.
    if (pending && !confirmed) return;
    const p = next.provider ?? provider;
    const url = (next.baseUrl ?? baseUrl).trim();
    const m = (next.model ?? model).trim();
    if (
      config &&
      config.provider === p &&
      (p !== "compatible" || (config.baseUrl ?? "") === url) &&
      config.model === m
    ) {
      return;
    }
    const c: AiConfig = { provider: p, model: m };
    if (p === "compatible") c.baseUrl = url;
    if (!(await run(() => aiConfigSet(c)))) showStored();
  };

  const applyProvider = async (p: Provider) => {
    setPending(null);
    setProvider(p);
    setBaseUrl("");
    setModel("");
    await save({ provider: p, baseUrl: "", model: "" }, true);
  };

  const pickProvider = (p: Provider) => {
    if (p === provider) return;
    if (status.hasKey) setPending({ kind: "provider", provider: p });
    else void applyProvider(p);
  };

  const blurUrl = () => {
    if (status.hasKey && baseUrl.trim() !== (config?.baseUrl ?? "")) {
      setPending({ kind: "url" });
    } else {
      void save({});
    }
  };

  const confirm = async () => {
    const p = pending;
    setPending(null);
    if (p?.kind === "provider") await applyProvider(p.provider);
    else if (p) await save({}, true);
  };

  const cancel = () => {
    setPending(null);
    showStored();
  };

  const commit = (e: { key: string; currentTarget: HTMLInputElement }) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  const saveKey = async () => {
    if (key === "") return;
    // First run: nothing is stored yet, so the provider shown is saved
    // first; the key belongs to it.
    if (!config) {
      const c: AiConfig = { provider, model: model.trim() };
      if (provider === "compatible") c.baseUrl = baseUrl.trim();
      if (!(await run(() => aiConfigSet(c)))) return;
    }
    if (await run(() => aiKeySet(key))) setKey("");
  };
  const lacking = missing(status);

  return (
    <div className="flex flex-col">
      <Row label={<label htmlFor="z-ai-provider">Provider</label>}>
        <select
          id="z-ai-provider"
          value={pending?.kind === "provider" ? pending.provider : provider}
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
            {pending.kind === "provider"
              ? "Changing the provider forgets the saved key."
              : "Changing the URL forgets the saved key."}
          </span>
          <button
            type="button"
            className={BUTTON}
            onClick={() => void confirm()}
          >
            {pending.kind === "provider" ? "Change provider" : "Change URL"}
          </button>
          <button type="button" className={BUTTON} onClick={cancel}>
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
            onBlur={blurUrl}
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
          placeholder={provider === "anthropic" ? ANTHROPIC_DEFAULT_MODEL : ""}
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
      {status.keychainError && (
        <p className="m-0 pb-1 text-ui-xs text-danger">
          {status.keychainError}
        </p>
      )}
      {lacking && <p className="m-0 pb-1 text-ui-xs text-muted">{lacking}</p>}
      {error && <ErrorText>{error}</ErrorText>}
      <p className="m-0 pt-3 text-ui-xs text-faint">
        Ask sends only what you ask about, and only when you press Enter. Hidden
        text is never sent.
      </p>
    </div>
  );
}
