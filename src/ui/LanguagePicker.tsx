import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { LanguageId } from "../model/types";
import { LANGUAGES } from "../editor/languages";

export interface LanguagePickerProps {
  open: boolean;
  current: LanguageId;
  onPick(id: LanguageId): void;
  onClose(): void;
  /**
   * A rename that would match the File's extension to `current`: shown as
   * the first row (while the filter is empty), selected whenever it changes.
   */
  rename?: { from: string; to: string } | null;
  onRename?(): void;
}

/** Floating Language list above the status bar, with a filter. */
export function LanguagePicker({
  open,
  current,
  onPick,
  onClose,
  rename,
  onRename,
}: LanguagePickerProps) {
  if (!open) return null;
  return (
    <PickerList
      current={current}
      onPick={onPick}
      onClose={onClose}
      rename={rename}
      onRename={onRename}
    />
  );
}

/** One row of the list: the rename offer, or a Language. */
type Row =
  | { rename: true; label: string }
  | { rename: false; id: LanguageId; label: string };

function PickerList({
  current,
  onPick,
  onClose,
  rename,
  onRename,
}: Omit<LanguagePickerProps, "open">) {
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(() =>
    rename
      ? 0
      : Math.max(
          0,
          LANGUAGES.findIndex((l) => l.id === current),
        ),
  );
  const root = useRef<HTMLDivElement>(null);
  const q = filter.trim().toLowerCase();
  const offer =
    rename && q === "" ? `Rename ${rename.from} → ${rename.to}` : null;
  const items: Row[] = [
    ...(offer ? [{ rename: true as const, label: offer }] : []),
    ...LANGUAGES.filter(
      (l) => l.label.toLowerCase().includes(q) || l.id.includes(q),
    ).map((l) => ({ rename: false as const, id: l.id, label: l.label })),
  ];
  const sel = Math.min(index, Math.max(0, items.length - 1));

  // A new offer (after a pick) starts over on it, so Enter renames.
  const offerKey = rename ? `${rename.from}/${rename.to}` : "";
  const [seenOffer, setSeenOffer] = useState(offerKey);
  if (offerKey !== seenOffer) {
    setSeenOffer(offerKey);
    if (offerKey) {
      setFilter("");
      setIndex(0);
    }
  }

  const choose = (row: Row) => {
    if (row.rename) onRename?.();
    else onPick(row.id);
  };

  // A click anywhere outside closes the list (the status bar button
  // toggles it itself).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (root.current?.contains(t)) return;
      if (t.closest?.("[data-language-button]")) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = items.length;
    if (e.key === "ArrowDown" && n > 0) {
      setIndex((sel + 1) % n);
    } else if (e.key === "ArrowUp" && n > 0) {
      setIndex((sel - 1 + n) % n);
    } else if (e.key === "Enter") {
      if (items[sel]) choose(items[sel]);
    } else if (e.key === "Escape") {
      onClose();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Language"
      className="z-fade-in absolute right-2 bottom-7 z-20 w-52 rounded-float bg-surface p-1 shadow-float"
    >
      <input
        autoFocus
        spellCheck={false}
        value={filter}
        placeholder="Language"
        aria-label="Filter languages"
        onChange={(e) => {
          setFilter(e.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
        className="mb-1 w-full rounded-[4px] bg-chrome px-2 py-1 text-text outline-none placeholder:text-faint"
      />
      <ul role="listbox">
        {items.map((l, i) => (
          <li
            key={l.rename ? "rename" : l.id}
            role="option"
            aria-selected={i === sel}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(l);
            }}
            className={`flex cursor-default items-center rounded-[4px] px-2 py-1 ${
              i === sel ? "bg-accent-soft text-text" : "text-muted"
            } ${l.rename ? "mb-1 border-b border-hairline" : ""}`}
            title={l.rename ? l.label : undefined}
          >
            {l.rename ? (
              <span className="min-w-0 truncate">{l.label}</span>
            ) : (
              l.label
            )}
            {!l.rename && l.id === current && (
              <span className="ml-auto text-faint" aria-hidden>
                ✓
              </span>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-2 py-1 text-faint">No match</li>
        )}
      </ul>
    </div>
  );
}
