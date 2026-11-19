import { useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { formatKeys, shortcutsFor } from "../app/shortcutList";
import type { Platform } from "../app/shortcuts";
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from "../model/session";
import type { Settings, ThemePref } from "../model/settings";

export interface SettingsDialogProps {
  settings: Settings;
  /** The editor's text size in px. */
  fontSize: number;
  platform: Platform;
  /** Applied at once (and saved with the Session). */
  onSettings(patch: Partial<Settings>): void;
  onFontSize(px: number): void;
  onClose(): void;
}

type Section = "general" | "shortcuts";

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const BUTTON =
  "rounded-[5px] px-2 py-[3px] text-muted hover:bg-row-hover hover:text-text disabled:pointer-events-none disabled:opacity-40";

/** Settings and the keyboard shortcut list (Mod+, or the status bar gear). */
export function SettingsDialog({
  settings,
  fontSize,
  platform,
  onSettings,
  onFontSize,
  onClose,
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(0_0_0/0.25)]"
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
        className="z-fade-in flex h-[min(520px,80vh)] w-[min(540px,calc(100vw-32px))] flex-col rounded-float bg-surface text-[12.5px] text-text shadow-float outline-none"
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-3 pt-2.5">
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
            className="mb-1.5 flex size-6 items-center justify-center rounded-[4px] text-faint hover:bg-row-hover hover:text-text"
          >
            <svg width="9" height="9" viewBox="0 0 8 8" aria-hidden="true">
              <path
                d="M1 1l6 6M7 1L1 7"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div role="tabpanel" className="min-h-0 overflow-y-auto px-4 py-3">
          {section === "general" ? (
            <General
              settings={settings}
              fontSize={fontSize}
              onSettings={onSettings}
              onFontSize={onFontSize}
            />
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
        "-mb-px border-b-2 px-2 pb-2 " +
        (selected
          ? "border-accent text-text"
          : "border-transparent text-muted hover:text-text")
      }
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-4">
      <div className="flex-1 text-text">{label}</div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
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
  // What's typed, until it's a valid size.
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="flex flex-col">
      <Row label="Theme">
        <div
          role="radiogroup"
          aria-label="Theme"
          className="flex rounded-[6px] bg-chrome p-0.5"
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={settings.theme === t.id}
              onClick={() => onSettings({ theme: t.id })}
              className={
                "rounded-[4px] px-2.5 py-[3px] " +
                (settings.theme === t.id
                  ? "bg-surface text-text shadow-float"
                  : "text-muted hover:text-text")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Editor font size">
        <button
          type="button"
          aria-label="Smaller"
          disabled={fontSize <= MIN_FONT_SIZE}
          onClick={() => onFontSize(fontSize - 1)}
          className={BUTTON}
        >
          −
        </button>
        <input
          type="number"
          aria-label="Font size"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={typed ?? fontSize}
          onChange={(e) => {
            const v = e.target.value;
            const n = Number(v);
            const ok =
              v.trim() !== "" &&
              Number.isFinite(n) &&
              n >= MIN_FONT_SIZE &&
              n <= MAX_FONT_SIZE;
            setTyped(ok ? null : v);
            if (ok) onFontSize(n);
          }}
          onBlur={() => setTyped(null)}
          className="w-12 rounded-[4px] bg-chrome px-1.5 py-[3px] text-center text-text outline-none focus:shadow-[inset_0_0_0_1px_var(--z-accent-soft)] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label="Larger"
          disabled={fontSize >= MAX_FONT_SIZE}
          onClick={() => onFontSize(fontSize + 1)}
          className={BUTTON}
        >
          +
        </button>
        <span className="w-5 text-faint">px</span>
        <button
          type="button"
          disabled={fontSize === DEFAULT_FONT_SIZE}
          onClick={() => {
            setTyped(null);
            onFontSize(DEFAULT_FONT_SIZE);
          }}
          className={BUTTON}
        >
          Reset
        </button>
      </Row>
      <Row
        label={
          <>
            <label htmlFor="z-wrap-new">Word wrap in new tabs</label>
            <span id="z-wrap-new-hint" className="block text-[11px] text-faint">
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
          className="size-3.5 accent-[var(--z-accent)]"
        />
      </Row>
      <Row label={<label htmlFor="z-line-numbers">Line numbers</label>}>
        <input
          id="z-line-numbers"
          type="checkbox"
          checked={settings.lineNumbers}
          onChange={(e) => onSettings({ lineNumbers: e.target.checked })}
          className="size-3.5 accent-[var(--z-accent)]"
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
        className="w-full rounded-[5px] bg-chrome px-2 py-1 text-text outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
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
                  className="pt-3 pb-1 text-left text-[10.5px] font-normal tracking-[0.02em] text-faint"
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
                    <td className="py-1.5 pr-4 text-text">{r.action}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {r.shown.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="px-1 text-faint">or</span>}
                          <kbd className="rounded-[4px] border border-hairline bg-chrome px-1.5 py-px font-[inherit] text-[11px] text-muted">
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
