import type { KeyboardEvent } from "react";

export type CloseChoice = "save" | "discard" | "cancel";

const BUTTON = "rounded-[6px] px-3 py-1 font-medium";

/** Asked before closing a File Tab with Unsaved changes. */
export function SaveChangesDialog({
  name,
  onChoose,
}: {
  name: string;
  onChoose(c: CloseChoice): void;
}) {
  // Keys stay in the dialog: no app shortcut runs behind it.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onChoose("cancel");
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(0_0_0/0.4)]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="z-save-changes-title"
        onKeyDown={onKeyDown}
        className="z-fade-in flex w-[min(400px,calc(100vw-32px))] flex-col gap-4 rounded-[12px] bg-surface p-5 text-[13px] text-text shadow-float outline-none"
      >
        <h2
          id="z-save-changes-title"
          className="m-0 text-[14px] font-semibold break-all"
        >
          Save changes to {name}?
        </h2>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => onChoose("save")}
            className={`${BUTTON} bg-accent text-accent-fg`}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => onChoose("discard")}
            className={`${BUTTON} text-muted hover:bg-row-hover hover:text-text`}
          >
            Don't save
          </button>
          <button
            type="button"
            onClick={() => onChoose("cancel")}
            className={`${BUTTON} text-muted hover:bg-row-hover hover:text-text`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
