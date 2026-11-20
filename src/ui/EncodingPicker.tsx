import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
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
    const onBlur = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
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
      <div className="px-2.5 pt-1.5 pb-1 text-ui-xs font-semibold tracking-[0.04em] text-faint">
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
        className="mb-1.5 h-8 w-full rounded-[6px] border border-hairline bg-sunken px-2.5 text-text outline-none placeholder:text-faint focus:border-accent"
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
            className={`flex cursor-default items-center rounded-[6px] px-2.5 py-[6px] ${
              i === sel ? "bg-accent-soft text-text" : "text-muted"
            }`}
          >
            {encodingName(l)}
            {l === current && (
              <span className="ml-auto text-accent" aria-hidden>
                <Check size={15} strokeWidth={2} />
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
