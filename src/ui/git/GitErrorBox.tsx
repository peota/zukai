import type { GitError } from "../../git/api";
import { errorCopy } from "../../git/messages";
import { CloseIcon } from "../icons";

/** Keys the Library tree acts on; anything else (app shortcuts) bubbles. */
const TREE_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Enter",
  "F2",
  "Delete",
  "Escape",
]);

export function isTreeKey(e: React.KeyboardEvent): boolean {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "a") {
    return true;
  }
  return TREE_KEYS.has(e.key);
}

/**
 * A git failure in the float style of the rename error: one plain sentence,
 * git's own line in mono, and (with `onDismiss`) a dismiss button.
 */
export function GitErrorBox({
  error,
  onDismiss,
}: {
  error: GitError;
  onDismiss?(): void;
}) {
  const copy = errorCopy(error);
  return (
    <div
      role="alert"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (isTreeKey(e)) e.stopPropagation();
      }}
      className="z-fade-in my-1 mr-1 flex items-start gap-1.5 rounded-float bg-surface px-2.5 py-1.5 text-ui-sm whitespace-normal text-danger shadow-float"
    >
      <div className="min-w-0 flex-1">
        <div>{copy}</div>
        {error.detail && error.detail !== copy && (
          <div className="mt-1 font-mono text-ui-xs break-words text-muted">
            {error.detail}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
          className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-faint hover:bg-row-hover hover:text-text"
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  );
}
