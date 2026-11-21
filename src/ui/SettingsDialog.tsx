import { useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { formatKeys, shortcutsFor } from "../app/shortcutList";
import type { Platform } from "../app/shortcuts";
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from "../model/session";
import {
  DEFAULT_UI_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
} from "../model/settings";
import type {
  Accent,
  DarkTheme,
  LightTheme,
  Settings,
  ThemePref,
} from "../model/settings";
import type { AiStatus } from "../ask/api";
import { AiSettings } from "./AiSettings";
import { CloseIcon, Icon } from "./icons";
import type { MarkdownMode } from "../model/types";

export interface SettingsDialogProps {
  settings: Settings;
  /** The editor's text size in px. */
  fontSize: number;
  platform: Platform;
  /** Applied at once (and saved with the Session). */
  onSettings(patch: Partial<Settings>): void;
  onFontSize(px: number): void;
  onClose(): void;
  aiStatus: AiStatus;
  onAiStatus(s: AiStatus): void;
}

type Section = "general" | "ai" | "shortcuts";

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const MARKDOWN_MODES: { id: MarkdownMode; label: string }[] = [
  { id: "rich", label: "Rich editor" },
  { id: "markdown", label: "Markdown" },
];

export const BUTTON =
  "rounded-[5px] px-2 py-[3px] text-muted hover:bg-row-hover hover:text-text disabled:pointer-events-none disabled:opacity-40";

/** Settings and the keyboard shortcut list (Mod+, or the status bar gear). */
export function SettingsDialog({
  settings,
  fontSize,
  platform,
  onSettings,
  onFontSize,
  onClose,
  aiStatus,
  onAiStatus,
}: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("general");

  // Keys stay in the dialog: no app shortcut runs behind it.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      data-testid="settings-backdrop"
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(0_0_0/0.4)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        ref={(el) => {
          // Into the dialog on open, unless something in it already has it.
          if (el && !el.contains(document.activeElement)) el.focus();
        }}
        className="z-fade-in flex h-[min(620px,85vh)] w-[min(600px,calc(100vw-32px))] flex-col rounded-[12px] bg-surface text-ui text-text shadow-float outline-none"
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-4 pt-3">
          <div
            role="tablist"
            aria-label="Settings sections"
            className="flex flex-1 gap-1"
          >
            <SectionTab
              selected={section === "general"}
              onSelect={() => setSection("general")}
            >
              General
            </SectionTab>
            <SectionTab
              selected={section === "ai"}
              onSelect={() => setSection("ai")}
            >
              AI
            </SectionTab>
            <SectionTab
              selected={section === "shortcuts"}
              onSelect={() => setSection("shortcuts")}
            >
              Keyboard shortcuts
            </SectionTab>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            title="Close (Esc)"
            onClick={onClose}
            className="mb-2 flex size-7 items-center justify-center rounded-[6px] text-faint hover:bg-row-hover hover:text-text"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <div role="tabpanel" className="min-h-0 overflow-y-auto px-5 py-4">
          {section === "general" ? (
            <General
              settings={settings}
              fontSize={fontSize}
              onSettings={onSettings}
              onFontSize={onFontSize}
            />
          ) : section === "ai" ? (
            <AiSettings status={aiStatus} onStatus={onAiStatus} />
          ) : (
            <Shortcuts platform={platform} />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTab({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={
        "-mb-px border-b-2 px-2 pb-2.5 font-medium " +
        (selected
          ? "border-accent text-text"
          : "border-transparent text-muted hover:text-text")
      }
    >
      {children}
    </button>
  );
}

interface ThemeOption<T extends string> {
  id: T;
  label: string;
  /** The theme's own colors, for its preview tile. */
  chrome: string;
  editor: string;
  ink: string;
}

const LIGHT_THEME_OPTIONS: ThemeOption<LightTheme>[] = [
  {
    id: "paper",
    label: "Paper",
    chrome: "#f4f4f5",
    editor: "#ffffff",
    ink: "#18181b",
  },
  {
    id: "solar-light",
    label: "Solar Light",
    chrome: "#f1ece1",
    editor: "#fbf8f2",
    ink: "#2a251e",
  },
];

const DARK_THEME_OPTIONS: ThemeOption<DarkTheme>[] = [
  {
    id: "graphite",
    label: "Graphite",
    chrome: "#18181b",
    editor: "#1f1f23",
    ink: "#e7e7ea",
  },
  {
    id: "midnight",
    label: "Midnight",
    chrome: "#0e121a",
    editor: "#131925",
    ink: "#e1e6ef",
  },
  {
    id: "solar-dark",
    label: "Solar Dark",
    chrome: "#1a1815",
    editor: "#211f1b",
    ink: "#ebe4d8",
  },
];

const ACCENT_OPTIONS: { id: Accent; label: string; color: string }[] = [
  { id: "blue", label: "Blue", color: "#3b74ee" },
  { id: "violet", label: "Violet", color: "#8b5cf6" },
  { id: "green", label: "Green", color: "#22a05a" },
  { id: "orange", label: "Orange", color: "#e8762b" },
  { id: "pink", label: "Pink", color: "#e5488f" },
];

/** A segmented control: one of a few short choices. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-px rounded-[7px] bg-row-hover p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={
            "rounded-[5px] px-3 py-1 " +
            (value === o.id
              ? "bg-surface text-text shadow-tab"
              : "text-muted hover:text-text")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Theme tiles: a small picture of each theme, with its name. */
function Swatches<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ThemeOption<T>[];
  onChange(v: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className="group flex w-[84px] flex-col items-center gap-1.5 rounded-[8px] p-1 text-ui-sm text-muted aria-checked:text-text"
        >
          <span
            aria-hidden="true"
            className="flex h-12 w-full overflow-hidden rounded-[6px] shadow-[0_0_0_1px_var(--z-hairline-strong)] group-aria-checked:shadow-[0_0_0_2px_var(--z-accent)]"
            style={{ background: o.chrome }}
          >
            <span className="w-5 shrink-0" />
            <span
              className="mt-2 flex flex-1 flex-col gap-1 rounded-tl-[4px] p-1.5"
              style={{ background: o.editor }}
            >
              <span
                className="h-1 w-3/4 rounded-full opacity-80"
                style={{ background: o.ink }}
              />
              <span
                className="h-1 w-1/2 rounded-full opacity-40"
                style={{ background: o.ink }}
              />
              <span className="h-1 w-1/3 rounded-full bg-accent" />
            </span>
          </span>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-4">
      <div className="flex-1 text-text">{label}</div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** A px size: −, a typed value, +, and Reset to the default. */
function SizeStepper({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange(px: number): void;
}) {
  // What's typed, until it's a valid size.
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={`${label} smaller`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className={BUTTON}
      >
        <Icon name="minus" size={14} />
      </button>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={typed ?? value}
        onChange={(e) => {
          const v = e.target.value;
          const n = Number(v);
          const ok =
            v.trim() !== "" && Number.isFinite(n) && n >= min && n <= max;
          setTyped(ok ? null : v);
          if (ok) onChange(n);
        }}
        onBlur={() => setTyped(null)}
        className="w-12 h-7 rounded-[6px] border border-hairline bg-sunken px-1.5 text-center text-text outline-none focus:shadow-[inset_0_0_0_1px_var(--z-accent-soft)] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`${label} larger`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className={BUTTON}
      >
        <Icon name="plus" size={14} />
      </button>
      <span className="w-5 text-faint">px</span>
      <button
        type="button"
        aria-label={`Reset ${label.toLowerCase()}`}
        disabled={value === defaultValue}
        onClick={() => {
          setTyped(null);
          onChange(defaultValue);
        }}
        className={BUTTON}
      >
        Reset
      </button>
    </>
  );
}

function General({
  settings,
  fontSize,
  onSettings,
  onFontSize,
}: Pick<
  SettingsDialogProps,
  "settings" | "fontSize" | "onSettings" | "onFontSize"
>) {
  return (
    <div className="flex flex-col">
      <Row label="Mode">
        <Segmented
          label="Theme"
          value={settings.theme}
          options={THEMES}
          onChange={(theme) => onSettings({ theme })}
        />
      </Row>
      <Row label="Light theme">
        <Swatches
          label="Light theme"
          value={settings.lightTheme}
          options={LIGHT_THEME_OPTIONS}
          onChange={(lightTheme) =>
            onSettings(
              settings.theme === "dark"
                ? { lightTheme, theme: "light" }
                : { lightTheme },
            )
          }
        />
      </Row>
      <Row label="Dark theme">
        <Swatches
          label="Dark theme"
          value={settings.darkTheme}
          options={DARK_THEME_OPTIONS}
          onChange={(darkTheme) =>
            onSettings(
              settings.theme === "light"
                ? { darkTheme, theme: "dark" }
                : { darkTheme },
            )
          }
        />
      </Row>
      <Row label="Accent">
        <div role="radiogroup" aria-label="Accent" className="flex gap-1.5">
          {ACCENT_OPTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-label={a.label}
              title={a.label}
              aria-checked={settings.accent === a.id}
              onClick={() => onSettings({ accent: a.id })}
              className="flex size-7 items-center justify-center rounded-full border-2 border-transparent aria-checked:border-text"
            >
              <span
                className="size-[18px] rounded-full"
                style={{ background: a.color }}
              />
            </button>
          ))}
        </div>
      </Row>
      <div className="my-2 h-px bg-hairline" />
      <Row label="Open Markdown notes in">
        <Segmented
          label="Open Markdown notes in"
          value={settings.markdownDefault}
          options={MARKDOWN_MODES}
          onChange={(markdownDefault) => onSettings({ markdownDefault })}
        />
      </Row>
      <Row label="Interface font size">
        <SizeStepper
          label="Interface font size"
          value={settings.uiFontSize}
          min={MIN_UI_FONT_SIZE}
          max={MAX_UI_FONT_SIZE}
          defaultValue={DEFAULT_UI_FONT_SIZE}
          onChange={(uiFontSize) => onSettings({ uiFontSize })}
        />
      </Row>
      <Row label="Editor font size">
        <SizeStepper
          label="Editor font size"
          value={fontSize}
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          defaultValue={DEFAULT_FONT_SIZE}
          onChange={onFontSize}
        />
      </Row>
      <Row
        label={
          <>
            <label htmlFor="z-wrap-new">Word wrap in new tabs</label>
            <span id="z-wrap-new-hint" className="block text-ui-xs text-faint">
              Alt+Z still toggles it in each tab.
            </span>
          </>
        }
      >
        <input
          id="z-wrap-new"
          aria-describedby="z-wrap-new-hint"
          type="checkbox"
          checked={settings.wrapNewTabs}
          onChange={(e) => onSettings({ wrapNewTabs: e.target.checked })}
          className="size-4 accent-[var(--z-accent)]"
        />
      </Row>
      <Row label={<label htmlFor="z-line-numbers">Line numbers</label>}>
        <input
          id="z-line-numbers"
          type="checkbox"
          checked={settings.lineNumbers}
          onChange={(e) => onSettings({ lineNumbers: e.target.checked })}
          className="size-4 accent-[var(--z-accent)]"
        />
      </Row>
      <Row
        label={
          <>
            <label htmlFor="z-autosave-files">Save files automatically</label>
            <span
              id="z-autosave-files-hint"
              className="block text-ui-xs text-faint"
            >
              Scratchpads always save themselves. When off, a file changes on
              disk only when you save it.
            </span>
          </>
        }
      >
        <input
          id="z-autosave-files"
          aria-describedby="z-autosave-files-hint"
          type="checkbox"
          checked={settings.autosaveFiles}
          onChange={(e) => onSettings({ autosaveFiles: e.target.checked })}
          className="size-4 accent-[var(--z-accent)]"
        />
      </Row>
    </div>
  );
}

function Shortcuts({ platform }: { platform: Platform }) {
  const [query, setQuery] = useState("");
  const all = useMemo(
    () =>
      shortcutsFor(platform).map((s) => ({
        ...s,
        shown: s.keys.map((k) => formatKeys(k, platform)),
      })),
    [platform],
  );
  const q = query.trim().toLowerCase();
  const rows = all.filter(
    (s) =>
      q === "" ||
      s.action.toLowerCase().includes(q) ||
      s.group.toLowerCase().includes(q) ||
      s.shown.some((k) => k.toLowerCase().includes(q)),
  );
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        autoFocus
        aria-label="Search shortcuts"
        placeholder="Search shortcuts"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 w-full rounded-[7px] border border-hairline bg-sunken px-2.5 text-text outline-none placeholder:text-faint focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {rows.length === 0 ? (
        <p className="m-0 py-2 text-faint">No shortcut matches</p>
      ) : (
        <table className="w-full border-collapse">
          {groups.map((g) => (
            <tbody key={g}>
              <tr>
                <th
                  colSpan={2}
                  scope="colgroup"
                  className="pt-4 pb-1.5 text-left text-ui-xs font-semibold tracking-[0.06em] text-faint"
                >
                  {g.toUpperCase()}
                </th>
              </tr>
              {rows
                .filter((r) => r.group === g)
                .map((r) => (
                  <tr
                    key={`${r.group}:${r.action}`}
                    className="border-t border-hairline first:border-t-0"
                  >
                    <td className="py-2 pr-4 text-text">{r.action}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {r.shown.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="px-1 text-faint">or</span>}
                          <kbd className="rounded-[5px] border border-hairline border-b-hairline-strong bg-sunken px-1.5 py-0.5 font-[inherit] text-ui-sm text-muted">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      )}
    </div>
  );
}
