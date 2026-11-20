import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Entry, QuickHit, QuickResult } from "../library/api";
import type { Platform } from "../app/shortcuts";
import { letterOf } from "../app/shortcuts";
import { Icon, type IconName, fileIcon } from "./icons";

/** The search runs this long after the last keystroke. */
export const QUICK_DEBOUNCE_MS = 40;
/** While an index is still building, the search is asked again this often. */
export const QUICK_POLL_MS = 300;

/** An open Tab, offered while the query is empty. */
export interface QuickTab {
  id: string;
  title: string;
  /** Where it lives (a folder), or what it is ("Scratchpad"). */
  detail: string;
  icon: IconName;
}

export interface QuickOpenProps {
  search(query: string): Promise<QuickResult>;
  /** Open Tabs other than the active one, most useful first. */
  tabs: QuickTab[];
  /** The tree a hit belongs to, shown before its folder; null for the Library. */
  treeLabel(path: string): string | null;
  onOpen(entry: Entry): void;
  onActivate(id: string): void;
  onClose(): void;
  platform: Platform;
}

type Row = { tab: QuickTab; hit?: never } | { hit: QuickHit; tab?: never };

/** The chars of `text` from `start`, the ones in `marks` emphasized. */
function marked(chars: string[], start: number, marks: Set<number>) {
  const out: ReactNode[] = [];
  let run = "";
  let on = false;
  const flush = (key: number) => {
    if (!run) return;
    out.push(
      on ? (
        <mark key={key} className="bg-transparent font-semibold text-accent">
          {run}
        </mark>
      ) : (
        run
      ),
    );
    run = "";
  };
  for (let i = start; i < chars.length; i++) {
    const m = marks.has(i);
    if (m !== on) {
      flush(i);
      on = m;
    }
    run += chars[i];
  }
  flush(chars.length);
  return out;
}

/**
 * Quick open (Mod+P): a floating list under the title bar. Typing finds
 * Library and added-folder files by a fuzzy match on their path; with
 * nothing typed it lists the open Tabs.
 */
export function QuickOpen({
  search,
  tabs,
  treeLabel,
  onOpen,
  onActivate,
  onClose,
  platform,
}: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QuickResult | null>(null);
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const seq = useRef(0);

  const q = query.trim();
  // Searching keeps the last hits until the new ones arrive.
  useEffect(() => {
    const mine = ++seq.current;
    if (!q) return;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      let r: QuickResult;
      try {
        r = await search(q);
      } catch {
        r = { hits: [], ready: true };
      }
      if (mine !== seq.current) return;
      setResult(r);
      if (!r.ready) timer = setTimeout(() => void ask(), QUICK_POLL_MS);
    };
    timer = setTimeout(() => void ask(), QUICK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, search]);

  const rows: Row[] = q
    ? (result?.hits ?? []).map((hit) => ({ hit }))
    : tabs.map((tab) => ({ tab }));
  const sel = Math.min(index, Math.max(0, rows.length - 1));

  useEffect(() => {
    const el = list.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [sel, rows.length]);

  // A click anywhere outside closes it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const choose = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      if (row.tab) onActivate(row.tab.id);
      else onOpen(row.hit.entry);
    },
    [onActivate, onOpen],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keys stay here: no app shortcut runs behind the list.
    e.stopPropagation();
    const n = rows.length;
    const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
    // Mod+P again moves down, as in VS Code.
    const down =
      e.key === "ArrowDown" || (mod && !e.shiftKey && letterOf(e) === "p");
    const up =
      e.key === "ArrowUp" || (mod && e.shiftKey && letterOf(e) === "p");
    if (down) {
      if (n > 0) setIndex((sel + 1) % n);
    } else if (up) {
      if (n > 0) setIndex((sel - 1 + n) % n);
    } else if (e.key === "PageDown") {
      setIndex(Math.min(n - 1, sel + 8));
    } else if (e.key === "PageUp") {
      setIndex(Math.max(0, sel - 8));
    } else if (e.key === "Enter") {
      choose(rows[sel]);
    } else if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Tab") {
      // Focus stays in the box.
    } else {
      return;
    }
    e.preventDefault();
  };

  let empty: string | null = null;
  if (rows.length === 0) {
    if (!q) empty = "Type to find a file in your Library";
    else if (result === null || (!result.ready && result.hits.length === 0)) {
      empty = "Searching…";
    } else empty = "No matching files";
  }

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Quick open"
      className="z-fade-in fixed top-11 left-1/2 z-40 flex max-h-[min(460px,70vh)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 flex-col rounded-float bg-surface p-1 shadow-float"
    >
      <input
        autoFocus
        spellCheck={false}
        autoComplete="off"
        value={query}
        placeholder="Search files by name"
        aria-label="Search files by name"
        aria-controls="quick-open-list"
        aria-activedescendant={rows.length ? `quick-open-${sel}` : undefined}
        role="combobox"
        aria-expanded="true"
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
        className="mb-1 h-9 w-full shrink-0 rounded-[6px] border border-hairline bg-sunken px-3 text-text outline-none placeholder:text-faint focus:border-accent"
      />
      {!q && tabs.length > 0 && (
        <div className="px-2.5 pt-1 pb-0.5 text-ui-xs tracking-wide text-faint uppercase">
          Open tabs
        </div>
      )}
      <ul
        ref={list}
        id="quick-open-list"
        role="listbox"
        aria-label={q ? "Matching files" : "Open tabs"}
        className="min-h-0 overflow-y-auto"
      >
        {rows.map((row, i) => (
          <QuickRow
            key={row.tab ? `tab:${row.tab.id}` : `file:${row.hit.entry.path}`}
            id={`quick-open-${i}`}
            row={row}
            selected={i === sel}
            treeLabel={treeLabel}
            onHover={() => setIndex(i)}
            onChoose={() => choose(row)}
          />
        ))}
      </ul>
      {empty && <div className="px-2.5 py-1.5 text-faint">{empty}</div>}
      {q && result && !result.ready && rows.length > 0 && (
        <div className="px-2.5 pt-1 text-ui-xs text-faint">
          Still indexing; more files may appear…
        </div>
      )}
    </div>
  );
}

function QuickRow({
  id,
  row,
  selected,
  treeLabel,
  onHover,
  onChoose,
}: {
  id: string;
  row: Row;
  selected: boolean;
  treeLabel(path: string): string | null;
  onHover(): void;
  onChoose(): void;
}) {
  let icon: IconName;
  let name: ReactNode;
  let detail: ReactNode;
  let title: string;
  if (row.tab) {
    icon = row.tab.icon;
    name = row.tab.title;
    detail = row.tab.detail;
    title = row.tab.detail;
  } else {
    const { entry, rel, positions } = row.hit;
    const chars = Array.from(rel);
    const nameLen = Array.from(entry.name).length;
    const nameStart = chars.length - nameLen;
    const marks = new Set(positions);
    icon = fileIcon(entry.name);
    name = marked(chars, nameStart, marks);
    // The folder part, without its trailing "/".
    const folderChars = chars.slice(0, Math.max(0, nameStart - 1));
    const tree = treeLabel(entry.path);
    detail = (
      <>
        {tree && <span>{tree}</span>}
        {tree && folderChars.length > 0 && "/"}
        {marked(folderChars, 0, marks)}
      </>
    );
    title = entry.path;
  }
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      title={title}
      onMouseMove={onHover}
      onMouseDown={(e) => {
        e.preventDefault();
        onChoose();
      }}
      className={`flex cursor-default items-center gap-2 rounded-[6px] px-2.5 py-[5px] ${
        selected ? "bg-accent-soft text-text" : "text-text"
      }`}
    >
      <Icon name={icon} size={15} className="text-muted" />
      <span className="shrink-0 truncate">{name}</span>
      <span className="min-w-0 truncate text-ui-sm text-faint">{detail}</span>
    </li>
  );
}
