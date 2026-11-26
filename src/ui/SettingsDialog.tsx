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
import { Info, Keyboard, Palette, PenLine, FolderOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BUTTON, Group, Row } from "./settingsRows";
import { CloseIcon, Icon } from "./icons";
import type { MarkdownMode } from "../model/types";
import type { Updater } from "../app/useUpdater";

export interface SettingsDialogProps {
  settings: Settings;
  /** The editor's text size in px. */
  fontSize: number;
  platform: Platform;
  /** Applied at once (and saved with the Session). */
  onSettings(patch: Partial<Settings>): void;
  onFontSize(px: number): void;
  onClose(): void;
  /** Version and updates, shown under About. */
  updater?: Updater;
  /** Opens the release page (for copies that can't update themselves). */
  onOpenReleases?(): void;
  /** The section shown first. */
  initialSection?: Section;
}

export type Section = "appearance" | "editor" | "files" | "shortcuts" | "about";

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: PenLine },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
];

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const MARKDOWN_MODES: { id: MarkdownMode; label: string }[] = [
  { id: "rich", label: "Rich editor" },
  { id: "markdown", label: "Markdown" },
];

/** Settings and the keyboard shortcut list (Mod+, or the status bar gear). */
export function SettingsDialog({
  settings,
  fontSize,
  platform,
  onSettings,
  onFontSize,
  onClose,
  updater,
  onOpenReleases,
  initialSection = "appearance",
}: SettingsDialogProps) {
  const [section, setSection] = useState<Section>(initialSection);
  const current = SECTIONS.find((x) => x.id === section)!;

  // Keys stay in the dialog: no app shortcut runs behind it.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Up / Down move between sections, as in any vertical tab list.
  const onNavKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = SECTIONS.findIndex((x) => x.id === section);
    const n = SECTIONS.length;
    const next = SECTIONS[(i + (e.key === "ArrowDown" ? 1 : n - 1)) % n];
    setSection(next.id);
    e.currentTarget
      .querySelector<HTMLElement>(`[data-section="${next.id}"]`)
      ?.focus();
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
        className="z-fade-in flex h-[min(680px,88vh)] w-[min(860px,calc(100vw-32px))] overflow-hidden rounded-[12px] bg-surface text-ui text-text shadow-float outline-none"
      >
        <nav className="flex w-[216px] shrink-0 flex-col border-r border-hairline bg-side px-3 pt-5 pb-3">
          <h2 className="m-0 mb-4 px-2.5 text-ui-lg font-semibold text-text">
            Settings
          </h2>
          <div
            role="tablist"
            aria-label="Settings sections"
            aria-orientation="vertical"
            onKeyDown={onNavKey}
            className="flex flex-col gap-0.5"
          >
            {SECTIONS.map((x) => (
              <SectionTab
                key={x.id}
                id={x.id}
                icon={x.icon}
                selected={section === x.id}
                onSelect={() => setSection(x.id)}
                dot={x.id === "about" && updater?.newVersion != null}
              >
                {x.label}
              </SectionTab>
            ))}
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-16 shrink-0 items-center gap-3 pr-4 pl-8">
            <h2 className="m-0 flex-1 text-[calc(var(--z-ui-font)+4px)] font-semibold text-text">
              {current.label}
            </h2>
            <button
              type="button"
              aria-label="Close settings"
              title="Close (Esc)"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-[6px] text-faint hover:bg-row-hover hover:text-text"
            >
              <CloseIcon size={16} />
            </button>
          </div>
          <div
            role="tabpanel"
            aria-label={current.label}
            className="min-h-0 flex-1 overflow-y-auto px-8 pt-2 pb-8"
          >
            {section === "shortcuts" ? (
              <Shortcuts platform={platform} />
            ) : section === "about" ? (
              <About updater={updater} onOpenReleases={onOpenReleases} />
            ) : section === "appearance" ? (
              <Appearance
                settings={settings}
                fontSize={fontSize}
                onSettings={onSettings}
                onFontSize={onFontSize}
              />
            ) : section === "editor" ? (
              <Editor settings={settings} onSettings={onSettings} />
            ) : (
              <Files settings={settings} onSettings={onSettings} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTab({
  id,
  icon: I,
  selected,
  onSelect,
  dot = false,
  children,
}: {
  id: Section;
  icon: LucideIcon;
  selected: boolean;
  onSelect(): void;
  /** Marks a section that needs a look (an update to install). */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      data-section={id}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={
        "flex h-9 items-center gap-2.5 rounded-[6px] px-2.5 text-left text-ui-lg outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--z-accent)] " +
        (selected
          ? "bg-row-sel text-text"
          : "text-muted hover:bg-row-hover hover:text-text")
      }
    >
      <I
        size={16}
        strokeWidth={1.6}
        aria-hidden="true"
        className={"shrink-0 " + (selected ? "text-accent" : "")}
      />
      {children}
      {dot && (
        <span
          aria-label="Update available"
          className="ml-auto size-2 shrink-0 rounded-full bg-accent"
        />
      )}
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
      className="flex gap-px rounded-[8px] bg-row-hover p-[3px]"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={
            "h-7 rounded-[6px] px-3.5 " +
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
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-3">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className="group flex w-[112px] flex-col items-start gap-2 rounded-[8px] text-ui text-muted outline-none hover:text-text aria-checked:text-text"
        >
          <span
            aria-hidden="true"
            className="flex h-16 w-full overflow-hidden rounded-[8px] shadow-[0_0_0_1px_var(--z-hairline-strong)] group-aria-checked:shadow-[0_0_0_2px_var(--z-accent)] group-focus-visible:shadow-[0_0_0_2px_var(--z-accent-soft)]"
            style={{ background: o.chrome }}
          >
            <span className="w-6 shrink-0" />
            <span
              className="mt-2.5 flex flex-1 flex-col gap-1.5 rounded-tl-[5px] p-2"
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
        className="h-8 w-14 rounded-[6px] border border-hairline bg-sunken px-2 text-center text-text outline-none focus:border-accent [&::-webkit-inner-spin-button]:appearance-none"
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
      <span className="w-6 text-center text-faint">px</span>
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

type SectionProps = Pick<
  SettingsDialogProps,
  "settings" | "fontSize" | "onSettings" | "onFontSize"
>;

function Appearance({
  settings,
  fontSize,
  onSettings,
  onFontSize,
}: SectionProps) {
  return (
    <>
      <Group title="Theme">
        <Row label="Mode" hint="Light or dark, or follow the system.">
          <Segmented
            label="Theme"
            value={settings.theme}
            options={THEMES}
            onChange={(theme) => onSettings({ theme })}
          />
        </Row>
        <Row label="Light theme" stack>
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
        <Row label="Dark theme" stack>
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
        <Row label="Accent" hint="Selection, focus, links and checks.">
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
                className="flex size-8 items-center justify-center rounded-full border-2 border-transparent aria-checked:border-text"
              >
                <span
                  className="size-5 rounded-full"
                  style={{ background: a.color }}
                />
              </button>
            ))}
          </div>
        </Row>
      </Group>
      <Group title="Text size">
        <Row
          label="Interface font size"
          hint="Sidebar, tabs, menus and dialogs."
        >
          <SizeStepper
            label="Interface font size"
            value={settings.uiFontSize}
            min={MIN_UI_FONT_SIZE}
            max={MAX_UI_FONT_SIZE}
            defaultValue={DEFAULT_UI_FONT_SIZE}
            onChange={(uiFontSize) => onSettings({ uiFontSize })}
          />
        </Row>
        <Row label="Editor font size" hint="Notes and files in the editor.">
          <SizeStepper
            label="Editor font size"
            value={fontSize}
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            defaultValue={DEFAULT_FONT_SIZE}
            onChange={onFontSize}
          />
        </Row>
      </Group>
    </>
  );
}

function Editor({
  settings,
  onSettings,
}: Pick<SettingsDialogProps, "settings" | "onSettings">) {
  return (
    <>
      <Group title="Markdown">
        <Row label="Open Markdown notes in">
          <Segmented
            label="Open Markdown notes in"
            value={settings.markdownDefault}
            options={MARKDOWN_MODES}
            onChange={(markdownDefault) => onSettings({ markdownDefault })}
          />
        </Row>
      </Group>
      <Group title="Text">
        <Row
          label={<label htmlFor="z-wrap-new">Word wrap in new tabs</label>}
          hint="Alt+Z still toggles it in each tab."
          hintId="z-wrap-new-hint"
        >
          <input
            id="z-wrap-new"
            aria-describedby="z-wrap-new-hint"
            type="checkbox"
            checked={settings.wrapNewTabs}
            onChange={(e) => onSettings({ wrapNewTabs: e.target.checked })}
            className="size-[18px] accent-[var(--z-accent)]"
          />
        </Row>
        <Row label={<label htmlFor="z-line-numbers">Line numbers</label>}>
          <input
            id="z-line-numbers"
            type="checkbox"
            checked={settings.lineNumbers}
            onChange={(e) => onSettings({ lineNumbers: e.target.checked })}
            className="size-[18px] accent-[var(--z-accent)]"
          />
        </Row>
      </Group>
    </>
  );
}

function Files({
  settings,
  onSettings,
}: Pick<SettingsDialogProps, "settings" | "onSettings">) {
  return (
    <>
      <Group title="Saving">
        <Row
          label={
            <label htmlFor="z-autosave-files">Save files automatically</label>
          }
          hint="Scratchpads always save themselves. When off, a file changes on disk only when you save it."
          hintId="z-autosave-files-hint"
        >
          <input
            id="z-autosave-files"
            aria-describedby="z-autosave-files-hint"
            type="checkbox"
            checked={settings.autosaveFiles}
            onChange={(e) => onSettings({ autosaveFiles: e.target.checked })}
            className="size-[18px] accent-[var(--z-accent)]"
          />
        </Row>
      </Group>
      <Group title="Library">
        <Row
          label={<label htmlFor="z-reveal-active">Reveal the open file</label>}
          hint="Switching tabs opens the file's folders in the sidebar and scrolls to it."
          hintId="z-reveal-active-hint"
        >
          <input
            id="z-reveal-active"
            aria-describedby="z-reveal-active-hint"
            type="checkbox"
            checked={settings.revealActiveFile}
            onChange={(e) => onSettings({ revealActiveFile: e.target.checked })}
            className="size-[18px] accent-[var(--z-accent)]"
          />
        </Row>
        <Row
          label={<label htmlFor="z-git-sync">Git sync</label>}
          hint="Show git status and Pull, Commit and Push for library folders."
          hintId="z-git-sync-hint"
        >
          <input
            id="z-git-sync"
            aria-describedby="z-git-sync-hint"
            type="checkbox"
            checked={settings.gitSync}
            onChange={(e) => onSettings({ gitSync: e.target.checked })}
            className="size-[18px] accent-[var(--z-accent)]"
          />
        </Row>
      </Group>
    </>
  );
}

/** What the update row says for each state. */
function updateHint(u: Updater): string {
  switch (u.status) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return "Zukai is up to date.";
    case "downloading":
      return u.progress == null
        ? `Downloading ${u.newVersion}…`
        : `Downloading ${u.newVersion}… ${Math.round(u.progress * 100)}%`;
    case "installing":
      return `Installing ${u.newVersion}. Zukai will restart.`;
    case "error":
      return `Couldn't update: ${u.error ?? "unknown error"}`;
    default:
      if (u.newVersion == null)
        return "Zukai checks for updates every few hours.";
      return u.canInstall
        ? `Zukai ${u.newVersion} is available. Your notes are saved before it restarts.`
        : `Zukai ${u.newVersion} is available. Get it from the release page or your package manager.`;
  }
}

function About({
  updater: u,
  onOpenReleases,
}: Pick<SettingsDialogProps, "updater" | "onOpenReleases">) {
  if (!u) return null;
  const working =
    u.status === "checking" ||
    u.status === "downloading" ||
    u.status === "installing";
  const hasUpdate = u.newVersion != null;
  return (
    <Group title="Updates">
      <Row label="Version">
        <span className="font-mono text-ui-lg text-muted">
          {u.currentVersion ?? "…"}
        </span>
      </Row>
      <Row
        label={hasUpdate ? `Zukai ${u.newVersion}` : "Updates"}
        hint={<span role="status">{updateHint(u)}</span>}
      >
        {hasUpdate && u.canInstall ? (
          <button
            type="button"
            disabled={working}
            onClick={() => void u.install()}
            className="flex h-8 items-center rounded-[6px] bg-accent px-3 font-medium text-accent-fg hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {u.status === "error" ? "Try again" : "Install and restart"}
          </button>
        ) : hasUpdate ? (
          <button type="button" onClick={onOpenReleases} className={BUTTON}>
            Open release page
          </button>
        ) : (
          <button
            type="button"
            disabled={working}
            onClick={() => void u.checkNow(true)}
            className={BUTTON}
          >
            Check for updates
          </button>
        )}
      </Row>
    </Group>
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
        className="h-10 w-full rounded-[8px] border border-hairline bg-sunken px-3.5 text-ui-lg text-text outline-none placeholder:text-faint focus:border-accent [&::-webkit-search-cancel-button]:hidden"
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
                  className="pt-7 pb-2 text-left text-ui-xs font-semibold tracking-[0.06em] text-faint"
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
                    <td className="py-2.5 pr-4 text-ui-lg text-text">
                      {r.action}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {r.shown.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="px-1 text-faint">or</span>}
                          <kbd className="rounded-[5px] border border-hairline border-b-hairline-strong bg-sunken px-2 py-1 font-[inherit] text-ui-sm text-muted">
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
