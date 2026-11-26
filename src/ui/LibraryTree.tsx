import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import type { Entry } from "../library/api";
import type { Row } from "../library/tree";
import { Chevron, fileIcon, Icon, MoreIcon } from "./icons";
import { parentOf, splitName } from "./libraryEntries";
import type { PointerHandlers } from "./useFolderDrag";

/** A folder delete waiting for the inline confirmation. */
export interface PendingTrash {
  path: string;
  name: string;
  /** Items listed in it, or null when it hasn't been listed. */
  count: number | null;
  /** A delete of several selected items; the question shows under `path`. */
  paths?: string[];
}

/** How a click or key changes the selection. */
export type SelectHow = "only" | "toggle" | "range" | "all";

export interface LibraryTreeProps {
  treeRef: RefObject<HTMLDivElement | null>;
  rows: Row[];
  /** Search results show every folder open. */
  searching: boolean;
  isOpen(path: string): boolean;
  activePath: string | null;
  /** The File last revealed (a new object each time): its row scrolls into view. */
  revealed?: { path: string } | null;
  /** Why an entry can't be acted on, or null. */
  blocked(e: Entry): string | null;
  /** The keyboard cursor. */
  cursor: string | null;
  onCursor(path: string | null): void;
  /** The rows selected together (Mod+click, Shift+click), or none. */
  selected: ReadonlySet<string>;
  /**
   * Moves the cursor to `path` and changes the selection: "only" clears it,
   * "toggle" (Mod+click) adds or removes the row, "range" (Shift) selects
   * from the anchor to it, "all" (Mod+A) selects every row.
   */
  onSelect(path: string, how: SelectHow): void;
  /** Enter on a selection: opens its Files. */
  onOpenSelected(): void;
  editing: string | null;
  /** The rename is of a File just created: Enter goes on to its editor. */
  editingNew?: boolean;
  onEditing(path: string | null): void;
  pendingTrash: PendingTrash | null;
  onConfirmTrash(): void;
  onCancelTrash(): void;
  /** The folder a drag would drop into, highlighted. */
  dropTarget: string | null;
  /** The drop would copy into another tree: the target shows "Copy". */
  dropCopy: boolean;
  /** A drag is on: rows ease their drop highlight in. */
  dragging?: boolean;
  /** The rows a drag in progress carries: they dim, lifted out. */
  dragged?: ReadonlySet<string>;
  onOpen(entry: Entry): void;
  onToggle(dir: string): void;
  onRename(path: string, name: string): Promise<string | null>;
  onRequestTrash(entry: Entry): void;
  onLeave(): void;
  /**
   * Right-click on a row, or (entry null) on the tree's empty part; also an
   * added folder heading's ⋯ button.
   */
  onContextMenu(entry: Entry | null, x: number, y: number): void;
  dragHandlers(entry: Entry): PointerHandlers;
  swallowClick(): boolean;
  /** Shown after the last row (a clone's placeholder); not a tree item. */
  footer?: ReactNode;
}

/** The Library tree (spec 5.2): rows, keyboard, inline rename and delete. */
export function LibraryTree({
  treeRef,
  rows,
  searching,
  isOpen,
  activePath,
  revealed = null,
  blocked: blockedOf,
  cursor,
  onCursor,
  selected,
  onSelect,
  onOpenSelected,
  editing,
  editingNew = false,
  onEditing,
  pendingTrash,
  onConfirmTrash,
  onCancelTrash,
  dropTarget,
  dropCopy,
  dragging = false,
  dragged,
  onOpen,
  onToggle,
  onRename,
  onRequestTrash,
  onLeave,
  onContextMenu,
  dragHandlers,
  swallowClick,
  footer,
}: LibraryTreeProps) {
  const index = rows.findIndex((r) => r.entry.path === cursor);
  const focusTree = () => treeRef.current?.focus({ preventScroll: true });

  const multi = selected.size > 0;

  // A revealed File's row scrolls into view (once per reveal).
  useEffect(() => {
    if (!revealed) return;
    const i = rows.findIndex((r) => r.entry.path === revealed.path);
    if (i < 0) return;
    treeRef.current
      ?.querySelector(`[data-row="${i}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new reveal scrolls
  }, [revealed]);

  /** Moves the cursor; Shift extends the selection, else it's cleared. */
  const moveTo = (i: number, extend = false) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    onSelect(r.entry.path, extend ? "range" : "only");
    treeRef.current
      ?.querySelector(`[data-row="${rows.indexOf(r)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  };

  /** Why a row can't be acted on: a blocked entry, or a missing folder. */
  const rowBlocked = (r: Row): boolean =>
    blockedOf(r.entry) !== null || r.heading?.available === false;

  /** Enter or a click: open a File, or open/close a folder. */
  const activate = (r: Row) => {
    const e = r.entry;
    if (rowBlocked(r)) return;
    if (!e.isDir) onOpen(e);
    else if (!searching) onToggle(e.path);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // the rename field or a button
    const r = index >= 0 ? rows[index] : undefined;
    const entry = r?.entry;
    const blocked = r ? rowBlocked(r) : true;
    // An added folder's heading is never renamed or trashed.
    const fixed = blocked || r?.heading !== undefined;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.key.toLowerCase() === "a") {
      if (r) onSelect(r.entry.path, "all");
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        moveTo(index < 0 ? 0 : index + 1, e.shiftKey);
        break;
      case "ArrowUp":
        moveTo(index < 0 ? 0 : index - 1, e.shiftKey);
        break;
      case "Home":
        moveTo(0, e.shiftKey);
        break;
      case "End":
        moveTo(rows.length - 1, e.shiftKey);
        break;
      case "ArrowRight":
        if (!r || !entry?.isDir || blocked) break;
        if (!isOpen(entry.path)) {
          if (!searching) onToggle(entry.path);
        } else if ((rows[index + 1]?.depth ?? -1) > r.depth) {
          moveTo(index + 1);
        }
        break;
      case "ArrowLeft": {
        if (!r || !entry) break;
        if (entry.isDir && isOpen(entry.path) && !searching && !blocked) {
          onToggle(entry.path);
          break;
        }
        for (let j = index - 1; j >= 0; j--) {
          if (rows[j].depth < r.depth) {
            moveTo(j);
            break;
          }
        }
        break;
      }
      case "Enter":
        if (multi) onOpenSelected();
        else if (r) activate(r);
        break;
      case "F2":
        if (entry && !fixed) onEditing(entry.path);
        break;
      case "Delete":
        // With a selection, the selection goes (the cursor row aside).
        if (multi && entry) onRequestTrash(entry);
        else if (entry && !fixed) onRequestTrash(entry);
        break;
      case "Escape":
        if (multi && r) onSelect(r.entry.path, "only");
        else onLeave();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  /** A click opens; Mod+click and Shift+click only change the selection. */
  const click = (ev: ReactMouseEvent, r: Row) => {
    if (swallowClick()) return;
    const path = r.entry.path;
    if (ev.shiftKey) return onSelect(path, "range");
    if (ev.ctrlKey || ev.metaKey) return onSelect(path, "toggle");
    onSelect(path, "only");
    activate(r);
  };

  const openMenu = (e: ReactMouseEvent, entry: Entry | null) => {
    // Fields and error text keep the native menu (Copy).
    if ((e.target as Element).closest("input, [role=alert]")) return;
    e.preventDefault();
    e.stopPropagation();
    // The context-menu key targets the tree itself: use the cursor's row.
    if (entry === null && e.target === e.currentTarget && index >= 0) {
      const el = treeRef.current?.querySelector(`[data-row="${index}"]`);
      const box = el?.getBoundingClientRect();
      onContextMenu(rows[index].entry, box?.left ?? 0, box?.bottom ?? 0);
      return;
    }
    if (entry) onCursor(entry.path);
    onContextMenu(entry, e.clientX, e.clientY);
  };

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Library"
      tabIndex={0}
      aria-multiselectable="true"
      data-z-library-tree=""
      aria-activedescendant={index >= 0 ? `z-lib-row-${index}` : undefined}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        // First focus: start on the active File if it shows, else the top.
        if (e.target !== e.currentTarget || index >= 0 || rows.length === 0) {
          return;
        }
        const a = rows.findIndex((r) => r.entry.path === activePath);
        onCursor(rows[a >= 0 ? a : 0].entry.path);
      }}
      onContextMenu={(e) => openMenu(e, null)}
      className="group/tree min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
    >
      {rows.map((r, i) => {
        const e = r.entry;
        const blocked = blockedOf(e);
        const open = e.isDir && (searching || isOpen(e.path));
        const active = e.path === activePath;
        const isCursor = i === index;
        const isSelected = selected.has(e.path);
        const target = dropTarget === e.path;
        const motion =
          (dragging
            ? "transition-[background-color,box-shadow,opacity] duration-150 ease-out motion-reduce:transition-none "
            : "") + (dragged?.has(e.path) ? "opacity-40 " : "");
        const copyHint = target && dropCopy && (
          <span
            data-copy-hint=""
            className="shrink-0 rounded-[4px] bg-accent-soft px-1.5 text-ui-xs text-text"
          >
            Copy
          </span>
        );
        if (r.heading) {
          const missing = !r.heading.available;
          return (
            <div
              key={e.path}
              id={`z-lib-row-${i}`}
              role="treeitem"
              data-row={i}
              data-path={e.path}
              data-dir="true"
              data-heading=""
              data-drop-target={target ? "true" : undefined}
              aria-label={e.name}
              aria-level={r.depth + 1}
              aria-expanded={missing ? false : open}
              aria-selected={multi ? false : isCursor}
              aria-disabled={missing ? "true" : undefined}
              title={e.path}
              style={{ paddingLeft: 8 }}
              onClick={(ev) => click(ev, r)}
              onContextMenu={(ev) => openMenu(ev, e)}
              {...dragHandlers(e)}
              className={
                "mt-2 flex h-8 cursor-default items-center gap-2 rounded-[6px] pr-1 whitespace-nowrap " +
                motion +
                (missing ? "text-faint " : "text-muted ") +
                (target
                  ? "bg-row-sel shadow-[inset_0_0_0_1px_var(--z-accent)] "
                  : "hover:bg-row-hover ") +
                (isCursor
                  ? "group-focus/tree:shadow-[inset_0_0_0_1px_var(--z-accent-soft)]"
                  : "")
              }
            >
              <span className="flex w-3.5 shrink-0 justify-center text-faint">
                <Chevron open={!missing && open} />
              </span>
              <span className="max-w-[70%] min-w-0 shrink-0 truncate">
                {e.name}
              </span>
              {/* The parent path, cut from the left so its end shows. */}
              <span className="min-w-0 flex-1 truncate text-left text-ui-sm text-faint [direction:rtl]">
                <bdi>{parentOf(e.path)}</bdi>
              </span>
              {missing && (
                <span className="shrink-0 text-ui-sm text-faint">
                  Not found
                </span>
              )}
              {copyHint}
              <button
                type="button"
                aria-label={`${e.name} actions`}
                title={`${e.name} actions`}
                tabIndex={-1}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onCursor(e.path);
                  const b = ev.currentTarget.getBoundingClientRect();
                  onContextMenu(e, b.left, b.bottom + 4);
                }}
                className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
              >
                <MoreIcon />
              </button>
            </div>
          );
        }
        return (
          <div key={e.path}>
            <div
              id={`z-lib-row-${i}`}
              role="treeitem"
              data-row={i}
              data-path={e.path}
              data-dir={e.isDir ? "true" : undefined}
              data-drop-target={target ? "true" : undefined}
              aria-label={e.name}
              aria-level={r.depth + 1}
              aria-expanded={e.isDir ? open : undefined}
              aria-selected={multi ? isSelected : isCursor}
              aria-current={active ? "true" : undefined}
              aria-disabled={blocked ? "true" : undefined}
              title={blocked ?? e.path}
              style={{ paddingLeft: 8 + r.depth * 16 }}
              onClick={(ev) => click(ev, r)}
              onContextMenu={(ev) => openMenu(ev, e)}
              {...dragHandlers(e)}
              className={
                "relative flex h-8 cursor-default items-center gap-2 rounded-[6px] pr-2 whitespace-nowrap " +
                motion +
                (blocked ? "text-faint " : "text-text ") +
                (target
                  ? "bg-row-sel shadow-[inset_0_0_0_1px_var(--z-accent)] "
                  : isSelected
                    ? "bg-accent-soft "
                    : active
                      ? "bg-row-sel "
                      : "hover:bg-row-hover ") +
                (isCursor
                  ? "group-focus/tree:shadow-[inset_0_0_0_1px_var(--z-accent-soft)]"
                  : "")
              }
            >
              {/* Indent guides: a hairline under each ancestor's chevron,
                  joining row to row into one line per open folder. */}
              {Array.from({ length: r.depth }, (_, d) => (
                <span
                  key={d}
                  aria-hidden="true"
                  data-indent-guide=""
                  className="pointer-events-none absolute inset-y-0 w-px bg-hairline"
                  style={{ left: 8 + d * 16 + 7 }}
                />
              ))}
              <span className="flex w-3.5 shrink-0 justify-center text-faint">
                {e.isDir && <Chevron open={open} />}
              </span>
              <Icon
                name={
                  e.link === "outside"
                    ? "link"
                    : e.isDir
                      ? "folder"
                      : fileIcon(e.name)
                }
                className={
                  blocked ? "text-faint" : active ? "text-accent" : "text-muted"
                }
              />
              {editing === e.path && !blocked ? (
                <RenameField
                  entry={e}
                  onSubmit={(name) => onRename(e.path, name)}
                  onClose={(how) => {
                    onEditing(null);
                    if (how === "enter" && editingNew) onLeave();
                    else if (how !== "blur") focusTree();
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
              )}
              {e.link === "inside" && (
                <span data-link-glyph="" className="shrink-0 text-faint">
                  <Icon name="link" size={12} />
                </span>
              )}
              {copyHint}
            </div>
            {pendingTrash?.path === e.path && (
              <TrashConfirm
                pending={pendingTrash}
                indent={8 + r.depth * 16}
                onConfirm={() => {
                  onConfirmTrash();
                  focusTree();
                }}
                onCancel={() => {
                  onCancelTrash();
                  focusTree();
                }}
              />
            )}
          </div>
        );
      })}
      {footer}
    </div>
  );
}

function trashQuestion(p: PendingTrash): string {
  if (p.paths) return `Move ${p.paths.length} items to the Trash?`;
  if (p.count === null) {
    return `Move "${p.name}" and everything in it to the Trash?`;
  }
  const items = p.count === 1 ? "1 item" : `${p.count} items`;
  return `Move "${p.name}" and its ${items} to the Trash?`;
}

/** The short inline question before a non-empty folder goes to the Trash. */
function TrashConfirm({
  pending,
  indent,
  onConfirm,
  onCancel,
}: {
  pending: PendingTrash;
  indent: number;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div
      role="group"
      aria-label="Confirm delete"
      style={{ marginLeft: indent }}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep app shortcuts and the tree out
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="z-fade-in my-1 mr-1 rounded-float bg-surface px-3 py-2.5 text-ui whitespace-normal text-text shadow-float"
    >
      <div>{trashQuestion(pending)}</div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          className="rounded-[6px] bg-danger px-2.5 py-1 font-medium text-danger-fg"
        >
          Move to Trash
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[6px] px-2.5 py-1 text-muted hover:bg-row-hover hover:text-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The inline rename field. A File edits only its stem, with the extension
 * shown fixed after it; a folder edits its whole name. A refusal keeps the
 * field open with the reason under it; Esc cancels.
 */
function RenameField({
  entry,
  onSubmit,
  onClose,
}: {
  entry: Entry;
  onSubmit(name: string): Promise<string | null>;
  /** How it closed: by Enter, by Escape, or by losing focus. */
  onClose(how: "enter" | "escape" | "blur"): void;
}) {
  const [split] = useState(() => splitName(entry.name, entry.isDir));
  const [value, setValue] = useState(split.stem);
  const [error, setError] = useState<{
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const done = useRef(false);

  const close = (how: "enter" | "escape" | "blur") => {
    if (done.current) return;
    done.current = true;
    onClose(how);
  };

  /** The full new name, or null when nothing would change. */
  const target = (): string | null => {
    let v = value.trim();
    if (!entry.isDir && split.ext) {
      // A name typed with its own extension keeps just one.
      if (v.toLowerCase().endsWith(split.ext.toLowerCase())) {
        v = v.slice(0, -split.ext.length).trim();
      }
      if (!v || v === split.stem) return null;
      return v + split.ext;
    }
    return !v || v === entry.name ? null : v;
  };

  const submit = async (fromKey: boolean) => {
    if (busy.current || done.current) return;
    const name = target();
    const how = fromKey ? "enter" : "blur";
    if (name === null) return close(how);
    busy.current = true;
    const result = await onSubmit(name);
    busy.current = false;
    if (done.current) return;
    if (!result) return close(how);
    const r = input.current?.getBoundingClientRect();
    setError({ text: result, left: r?.left ?? 0, top: (r?.bottom ?? 0) + 6 });
    if (fromKey) input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // keep app shortcuts and the tree out of the field
    if (e.key === "Enter") {
      e.preventDefault();
      void submit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close("escape");
    }
  };

  return (
    <>
      <input
        ref={input}
        autoFocus
        aria-label="Rename"
        value={value}
        aria-invalid={error !== null}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => void submit(false)}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded-[3px] bg-surface px-0.5 text-text shadow-[0_0_0_1px_var(--z-accent)] outline-none"
        spellCheck={false}
      />
      {split.ext && <span className="shrink-0 text-faint">{split.ext}</span>}
      {error && (
        <div
          role="alert"
          style={{ position: "fixed", left: error.left, top: error.top }}
          className="z-fade-in z-30 max-w-[280px] rounded-float bg-surface px-2.5 py-1.5 text-ui-sm whitespace-normal text-danger shadow-float"
        >
          {error.text}
        </div>
      )}
    </>
  );
}
