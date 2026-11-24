import { useEffect, useRef, useState } from "react";
import {
  Compartment,
  EditorState,
  Prec,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import type { DiffTarget } from "../../model/types";
import { languageOf } from "../../files/paths";
import { loadLanguage } from "../../editor/languages";
import { zukaiTheme } from "../../editor/theme";
import { readDisk } from "../../app/files/context";
import { listenSafely } from "../../app/useLibrary";
import { logError } from "../../app/workspaceEffects";
import { onLibraryChanged } from "../../library/api";
import { isUnder } from "../../ui/libraryEntries";
import { asGitError, gitHeadFile, type HeadFile } from "../api";
import { errorCopy } from "../messages";
import { joinRel } from "../paths";
import { DIFF_MAX_BYTES, normalizeEol } from "./diffText";

/** How long a burst of disk changes in the folder settles before a re-read. */
export const REFRESH_DEBOUNCE_MS = 300;

export interface DiffPaneProps {
  target: DiffTarget;
  /** The editor's text size in px. */
  fontSize: number;
  /** Opens the real File (an absolute path) in a normal Tab. */
  onOpenFile(path: string): void;
  /** Both sides are read again whenever this changes (the folder's git status). */
  refreshKey?: unknown;
}

/** What the pane shows. */
type Shown =
  | { kind: "loading" }
  | { kind: "binary" }
  | { kind: "tooLarge" }
  | { kind: "same" }
  | { kind: "diff"; original: string; modified: string }
  | { kind: "failed"; message: string };

/** One side: its text (empty when it doesn't exist), or why there is none. */
type Side = { kind: "text"; text: string } | { kind: "binary" | "tooLarge" };

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

const textSide = (text: string): Side =>
  // Each UTF-16 unit is at most 3 bytes: most texts need no count.
  text.length * 3 > DIFF_MAX_BYTES && utf8Bytes(text) > DIFF_MAX_BYTES
    ? { kind: "tooLarge" }
    : { kind: "text", text: normalizeEol(text) };

function headSide(h: HeadFile): Side {
  if (h.kind === "missing") return { kind: "text", text: "" };
  if (h.kind === "text") return textSide(h.text);
  return { kind: h.kind };
}

/** The committed side (at the old path of a rename) and the disk's. */
async function readBoth(t: DiffTarget): Promise<Shown> {
  const headPath = t.status === "renamed" && t.oldPath ? t.oldPath : t.path;
  const diskPath = joinRel(t.folder, t.path);
  const [head, disk] = await Promise.all([
    gitHeadFile(t.folder, headPath).then(
      (h) => ({ ok: true as const, side: headSide(h) }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    readDisk(diskPath),
  ]);
  if (!head.ok) {
    return { kind: "failed", message: errorCopy(asGitError(head.err)) };
  }
  let after: Side;
  if (disk.kind === "missing") {
    after = { kind: "text", text: "" };
  } else if (disk.kind === "failed") {
    if (disk.err.kind !== "too_large") {
      const name = t.path.slice(t.path.lastIndexOf("/") + 1);
      return {
        kind: "failed",
        message: `Can't read ${name}: ${disk.err.message}`,
      };
    }
    after = { kind: "tooLarge" };
  } else {
    after = disk.read.readable ? textSide(disk.read.text) : { kind: "binary" };
  }
  const before = head.side;
  if (before.kind === "binary" || after.kind === "binary") {
    return { kind: "binary" };
  }
  if (before.kind !== "text" || after.kind !== "text") {
    return { kind: "tooLarge" };
  }
  return before.text === after.text
    ? { kind: "same" }
    : { kind: "diff", original: before.text, modified: after.text };
}

const sameShown = (a: Shown, b: Shown) =>
  a.kind === b.kind &&
  (a.kind !== "diff" ||
    (b.kind === "diff" &&
      a.original === b.original &&
      a.modified === b.modified)) &&
  (a.kind !== "failed" || (b.kind === "failed" && a.message === b.message));

const fontSizeExt = (px: number): Extension =>
  Prec.highest(EditorView.theme({ "&": { fontSize: `${px}px` } }));

/**
 * A diff Tab's area: the File's last commit against its text on disk, in a
 * read-only unified merge view, under a bar with Open file. Binary, too
 * large and unchanged Files show one line instead.
 */
export function DiffPane({
  target,
  fontSize,
  onOpenFile,
  refreshKey,
}: DiffPaneProps) {
  const { folder, path, oldPath, status } = target;
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  /** Bumped by a (settled) disk change in the folder. */
  const [diskSeq, setDiskSeq] = useState(0);

  useEffect(() => {
    let stale = false;
    void readBoth({ folder, path, oldPath, status }).then((next) => {
      if (!stale) setShown((prev) => (sameShown(prev, next) ? prev : next));
    });
    return () => {
      stale = true;
    };
  }, [folder, path, oldPath, status, refreshKey, diskSeq]);

  useEffect(() => {
    let timer: number | undefined;
    const off = listenSafely(
      () =>
        onLibraryChanged((e) => {
          if (!e.dirs.some((d) => d === folder || isUnder(d, folder))) return;
          window.clearTimeout(timer);
          timer = window.setTimeout(
            () => setDiskSeq((n) => n + 1),
            REFRESH_DEBOUNCE_MS,
          );
        }),
      "listen library changes for a diff",
    );
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [folder]);

  /** The File's Language, as its text Tab would have it (plain on failure). */
  const [language, setLanguage] = useState<{
    path: string;
    ext: Extension;
  } | null>(null);
  useEffect(() => {
    let live = true;
    loadLanguage(languageOf(path))
      .catch((err: unknown) => {
        logError("load diff language")(err);
        return [];
      })
      .then((ext) => {
        if (live) setLanguage({ path, ext });
      });
    return () => {
      live = false;
    };
  }, [path]);
  const langExt = language?.path === path ? language.ext : null;

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const fontSizeRef = useRef(fontSize);
  const [sizeSlot] = useState(() => new Compartment());
  const original = shown.kind === "diff" ? shown.original : null;
  const modified = shown.kind === "diff" ? shown.modified : null;
  useEffect(() => {
    if (original === null || modified === null || !langExt || !host.current) {
      return;
    }
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: modified,
        extensions: [
          EditorState.readOnly.of(true),
          zukaiTheme,
          sizeSlot.of(fontSizeExt(fontSizeRef.current)),
          langExt,
          unifiedMergeView({
            original,
            mergeControls: false,
            collapseUnchanged: { margin: 3, minSize: 4 },
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, [original, modified, langExt, sizeSlot]);

  useEffect(() => {
    if (fontSizeRef.current === fontSize) return;
    fontSizeRef.current = fontSize;
    view.current?.dispatch({
      effects: sizeSlot.reconfigure(fontSizeExt(fontSize)),
    });
  }, [fontSize, sizeSlot]);

  const message =
    shown.kind === "binary"
      ? "Binary file changed"
      : shown.kind === "tooLarge"
        ? "Too large to show (over 1 MB)"
        : shown.kind === "same"
          ? "No changes since the last commit."
          : shown.kind === "failed"
            ? shown.message
            : null;

  return (
    <div className="flex size-full flex-col">
      <div className="flex h-9 shrink-0 select-none items-center gap-3 border-b border-hairline px-4 text-ui text-muted">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {path}
        </span>
        {status !== "deleted" && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onOpenFile(joinRel(folder, path))}
            className="shrink-0 rounded-[6px] bg-bar-btn-bg px-2.5 py-1 text-ui-sm font-medium text-text shadow-[0_0_0_1px_var(--z-bar-btn-ring)] hover:bg-bar-btn-hover"
          >
            Open file
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {shown.kind === "diff" ? (
          <div ref={host} className="size-full" />
        ) : message !== null ? (
          <div className="grid size-full select-none place-items-center px-6 text-center text-ui text-muted">
            {message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
