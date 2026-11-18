import { useRef, useState } from "react";
import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import type { Entry } from "../library/api";
import type { Row } from "../library/tree";
import { Chevron, fileIcon, Icon } from "./icons";
import { entryBlocked, splitName } from "./libraryEntries";
import type { PointerHandlers } from "./useFolderDrag";

/** A folder delete waiting for the inline confirmation. */
export interface PendingTrash {
  path: string;
  name: string;
  /** Items listed in it, or null when it hasn't been listed. */
  count: number | null;
}

export interface LibraryTreeProps {
  treeRef: RefObject<HTMLDivElement | null>;
  rows: Row[];
  /** Search results show every folder open. */
  searching: boolean;
  isOpen(path: string): boolean;
  activePath: string | null;
  /** The keyboard cursor. */
  cursor: string | null;
  onCursor(path: string | null): void;
  editing: string | null;
  onEditing(path: string | null): void;
  pendingTrash: PendingTrash | null;
  onConfirmTrash(): void;
  onCancelTrash(): void;
  /** The folder a drag would drop into, highlighted. */
  dropTarget: string | null;
  onOpen(entry: Entry): void;
  onToggle(dir: string): void;
  onRename(path: string, name: string): Promise<string | null>;
  onRequestTrash(entry: Entry): void;
  onLeave(): void;
  /** Right-click on a row, or (entry null) on the tree's empty part. */
  onContextMenu(entry: Entry | null, x: number, y: number): void;
  dragHandlers(entry: Entry): PointerHandlers;
  swallowClick(): boolean;
}

/** The Library tree (spec 5.2): rows, keyboard, inline rename and delete. */
export function LibraryTree({
  treeRef,
  rows,
  searching,
  isOpen,
  activePath,
  cursor,
  onCursor,
  editing,
  onEditing,
  pendingTrash,
  onConfirmTrash,
  onCancelTrash,
  dropTarget,
  onOpen,
  onToggle,
  onRename,
  onRequestTrash,
  onLeave,
  onContextMenu,
  dragHandlers,
  swallowClick,
}: LibraryTreeProps) {
  const index = rows.findIndex((r) => r.entry.path === cursor);
  const focusTree = () => treeRef.current?.focus({ preventScroll: true });

  const moveTo = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    onCursor(r.entry.path);
    treeRef.current
      ?.querySelector(`[data-row="${rows.indexOf(r)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  };

  /** Enter or a click: open a File, or open/close a folder. */
  const activate = (e: Entry) => {
    if (entryBlocked(e)) return;
    if (!e.isDir) onOpen(e);
    else if (!searching) onToggle(e.path);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // the rename field or a button
    const r = index >= 0 ? rows[index] : undefined;
    const entry = r?.entry;
    const blocked = entry ? entryBlocked(entry) !== null : true;
    switch (e.key) {
      case "ArrowDown":
        moveTo(index < 0 ? 0 : index + 1);
        break;
      case "ArrowUp":
        moveTo(index < 0 ? 0 : index - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
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
        if (entry) activate(entry);
        break;
      case "F2":
        if (entry && !blocked) onEditing(entry.path);
        break;
      case "Delete":
        if (entry && !blocked) onRequestTrash(entry);
        break;
      case "Escape":
        onLeave();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const openMenu = (e: ReactMouseEvent, entry: Entry | null) => {
    if ((e.target as Element).closest("input")) return; // native menu
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
      data-z-library-tree=""
      aria-activedescendant={index >= 0 ? `z-lib-row-${index}` : undefined}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => openMenu(e, null)}
      className="group/tree min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
    >
      {rows.map((r, i) => {
        const e = r.entry;
        const blocked = entryBlocked(e);
        const open = e.isDir && (searching || isOpen(e.path));
        const active = e.path === activePath;
        const isCursor = i === index;
        const target = dropTarget === e.path;
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
              aria-selected={isCursor}
              aria-current={active ? "true" : undefined}
              aria-disabled={blocked ? "true" : undefined}
              title={blocked ?? e.path}
              style={{ paddingLeft: 8 + r.depth * 14 }}
              onClick={() => {
                if (swallowClick()) return;
                onCursor(e.path);
                activate(e);
              }}
              onContextMenu={(ev) => openMenu(ev, e)}
              {...dragHandlers(e)}
              className={
                "flex h-[26px] cursor-default items-center gap-[7px] rounded-[6px] pr-2 whitespace-nowrap " +
                (blocked ? "text-faint " : "text-text ") +
                (target
                  ? "bg-row-sel shadow-[inset_0_0_0_1px_var(--z-accent)] "
                  : active
                    ? "bg-row-sel "
                    : "hover:bg-row-hover ") +
                (isCursor
                  ? "group-focus/tree:shadow-[inset_0_0_0_1px_var(--z-accent-soft)]"
                  : "")
              }
            >
              <span className="flex w-2.5 shrink-0 justify-center text-faint">
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
                className={blocked ? "text-faint" : "text-muted"}
              />
              {editing === e.path && !blocked ? (
                <RenameField
                  entry={e}
                  onSubmit={(name) => onRename(e.path, name)}
                  onClose={(refocus) => {
                    onEditing(null);
                    if (refocus) focusTree();
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
              )}
              {e.link === "inside" && (
                <span data-link-glyph="" className="shrink-0 text-faint">
                  <Icon name="link" size={10} />
                </span>
              )}
            </div>
            {pendingTrash?.path === e.path && (
              <TrashConfirm
                pending={pendingTrash}
                indent={8 + r.depth * 14}
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
    </div>
  );
}

function trashQuestion(p: PendingTrash): string {
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
      className="z-fade-in my-1 mr-1 rounded-float bg-surface px-2.5 py-2 text-[12px] whitespace-normal text-text shadow-float"
    >
      <div>{trashQuestion(pending)}</div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          className="rounded-[5px] bg-bar-btn-primary-bg px-2 py-[3px] text-bar-btn-primary-fg"
        >
          Move to Trash
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[5px] px-2 py-[3px] text-muted hover:bg-row-hover hover:text-text"
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
  /** `refocus`: give the keyboard back to the tree. */
  onClose(refocus: boolean): void;
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

  const close = (refocus: boolean) => {
    if (done.current) return;
    done.current = true;
    onClose(refocus);
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
    if (name === null) return close(fromKey);
    busy.current = true;
    const result = await onSubmit(name);
    busy.current = false;
    if (done.current) return;
    if (!result) return close(fromKey);
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
      close(true);
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
          className="z-fade-in z-30 max-w-[280px] rounded-float bg-surface px-2 py-1 text-[11.5px] whitespace-normal text-danger shadow-float"
        >
          {error.text}
        </div>
      )}
    </>
  );
}
