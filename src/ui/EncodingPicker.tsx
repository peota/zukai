import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { COMMON_ENCODINGS, encodingName } from "./encodings";

export interface EncodingPickerProps {
  /** "Reopen with encoding" or "Convert to". */
  title: string;
  /** The File's encoding label, ticked. */
  current: string;
  onPick(label: string): void;
  onClose(): void;
}

/** Floating, filterable list of common encodings above the status bar. */
export function EncodingPicker({
  title,
  current,
  onPick,
  onClose,
}: EncodingPickerProps) {
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(() =>
    Math.max(0, COMMON_ENCODINGS.indexOf(current)),
  );
  const root = useRef<HTMLDivElement>(null);
  const q = filter.trim().toLowerCase();
  const items = COMMON_ENCODINGS.filter(
    (l) => l.includes(q) || encodingName(l).toLowerCase().includes(q),
  );
  const sel = Math.min(index, Math.max(0, items.length - 1));

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = items.length;
    if (e.key === "ArrowDown" && n > 0) setIndex((sel + 1) % n);
    else if (e.key === "ArrowUp" && n > 0) setIndex((sel - 1 + n) % n);
    else if (e.key === "Enter") {
      if (items[sel]) onPick(items[sel]);
    } else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={title}
      className="z-fade-in absolute right-2 bottom-7 z-20 w-56 rounded-float bg-surface p-1 shadow-float"
    >
      <div className="px-2 pt-1 pb-0.5 text-[10.5px] tracking-wide text-faint">
        {title.toUpperCase()}
      </div>
      <input
        autoFocus
        spellCheck={false}
        value={filter}
        placeholder="Encoding"
        aria-label="Filter encodings"
        onChange={(e) => {
          setFilter(e.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
        className="mb-1 w-full rounded-[4px] bg-chrome px-2 py-1 text-text outline-none placeholder:text-faint"
      />
      <ul role="listbox" className="max-h-64 overflow-y-auto">
        {items.map((l, i) => (
          <li
            key={l}
            role="option"
            aria-selected={i === sel}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(l);
            }}
            className={`flex cursor-default items-center rounded-[4px] px-2 py-1 ${
              i === sel ? "bg-accent-soft text-text" : "text-muted"
            }`}
          >
            {encodingName(l)}
            {l === current && (
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
