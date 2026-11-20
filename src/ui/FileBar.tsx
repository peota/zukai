import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { TabState } from "../model/types";
import { baseName } from "../files/paths";
import { isExecPath } from "../model/kinds";
import { encodingLabel } from "./encodings";

export interface FileBarProps {
  tab: TabState;
  /** Its unsaved text (shadow) can't be read yet: no actions are safe. */
  unreadable?: boolean;
  onKeepMine(): void;
  onLoadDisk(): void;
  onSaveAs(): void;
  onSaveToOriginal(): void;
  onReopenWithEncoding(): void;
  onConvertToUtf8(): void;
  /** Opens the File in the OS's default app (never offered for executables). */
  onOpenDefault?(): void;
  /** Shows the File in the OS file manager; absent outside the Library. */
  onReveal?(): void;
  /** "Show in Explorer" / "Show in Finder". */
  revealLabel?: string;
}

export type BarKind = "warn" | "err" | "info";

/** The thin bar between the tab bar and the editor for a held File. */
export function FileBar(p: FileBarProps) {
  const file = p.tab.file;
  if (!file?.held) return null;
  const name = baseName(file.path);

  if (p.unreadable) {
    return (
      <Bar kind="info">
        {`${name} has unsaved text that can't be read yet.`}
      </Bar>
    );
  }
  const reveal = p.revealLabel ?? "Show in Explorer";
  if (p.tab.kind === "image") {
    // An image is never edited: nothing to save, no text to re-read. A
    // missing one has nothing to show in the file manager either.
    return file.held === "missing" ? (
      <Bar kind="err" actions={<BarButton disabled>{reveal}</BarButton>}>
        {`${name} was moved or deleted.`}
      </Bar>
    ) : null;
  }
  switch (file.held) {
    case "conflict":
      return (
        <Bar
          kind="warn"
          actions={
            <>
              <BarButton onClick={p.onLoadDisk}>Load disk version</BarButton>
              <BarButton primary onClick={p.onKeepMine}>
                Keep mine
              </BarButton>
            </>
          }
        >
          {`${name} was changed by another program while you were editing. Autosave is paused.`}
        </Bar>
      );
    case "missing":
      return (
        <Bar
          kind="err"
          actions={
            <>
              <BarButton onClick={p.onSaveAs}>Save as…</BarButton>
              <BarButton primary onClick={p.onSaveToOriginal}>
                Save to original path
              </BarButton>
            </>
          }
        >
          {`${name} was moved or deleted. Your text is still here, and nothing is saved until you choose.`}
        </Bar>
      );
    case "unencodable":
      return (
        <Bar
          kind="warn"
          actions={
            <BarButton primary onClick={p.onConvertToUtf8}>
              Convert to UTF-8
            </BarButton>
          }
        >
          {`Can't save: some characters can't be written in ${encodingLabel(file.format)}.`}
        </Bar>
      );
    case "readonly":
      return (
        <Bar
          kind="info"
          actions={
            isExecPath(file.path) ? (
              // It could run something: only ever shown, never opened.
              p.onReveal && <BarButton onClick={p.onReveal}>{reveal}</BarButton>
            ) : (
              <>
                {p.onOpenDefault && (
                  <BarButton onClick={p.onOpenDefault}>
                    Open with default app
                  </BarButton>
                )}
                <BarButton onClick={p.onReopenWithEncoding}>
                  Reopen with encoding…
                </BarButton>
              </>
            )
          }
        >
          This file isn't readable as text, so it's open read-only to protect
          it.
        </Bar>
      );
  }
}

const KIND_CLASS: Record<BarKind, string> = {
  warn: "bg-bar-warn-bg text-bar-warn-fg",
  err: "bg-bar-err-bg text-bar-err-fg",
  info: "bg-bar-info-bg text-bar-info-fg",
};

/** The thin notice bar above an editor (held Files, invalid canvases). */
export function Bar({
  kind,
  children,
  actions,
}: {
  kind: BarKind;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      role="alert"
      data-kind={kind}
      className={`z-fade-in flex shrink-0 select-none items-center gap-3 border-b border-hairline px-4 py-2 text-ui ${KIND_CLASS[kind]}`}
    >
      {kind === "warn" && (
        <TriangleAlert
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className="shrink-0"
        />
      )}
      <span className="min-w-0 flex-1">{children}</span>
      {actions}
    </div>
  );
}

function BarButton({
  primary = false,
  disabled = false,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick?(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className={
        "shrink-0 rounded-[6px] px-2.5 py-1 text-ui-sm font-medium disabled:pointer-events-none disabled:opacity-50 " +
        (primary
          ? "bg-bar-btn-primary-bg text-bar-btn-primary-fg hover:opacity-90"
          : "bg-bar-btn-bg text-text shadow-[0_0_0_1px_var(--z-bar-btn-ring)] hover:bg-bar-btn-hover")
      }
    >
      {children}
    </button>
  );
}
