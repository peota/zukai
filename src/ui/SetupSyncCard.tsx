import { useId, useState } from "react";
import type { GitError } from "../git/api";
import { GitErrorBox } from "./GitRow";

export interface SetupSyncCardProps {
  /** Left margin in px, matching the folder heading's name. */
  indent: number;
  /** Setup is running for this folder. */
  running: boolean;
  /** A failure before the folder became a repo. */
  error: GitError | null;
  /** The URL, trimmed and not empty. */
  onSetUp(url: string): void;
  onCancel(): void;
}

/**
 * Set up sync (spec 4.1): the inline card under a folder's heading that asks
 * for an empty remote, then inits, commits and pushes the folder to it.
 */
export function SetupSyncCard({
  indent,
  running,
  error,
  onSetUp,
  onCancel,
}: SetupSyncCardProps) {
  const [url, setUrl] = useState("");
  const id = useId();
  const empty = url.trim() === "";
  const submit = () => {
    if (!empty && !running) onSetUp(url.trim());
  };
  return (
    <>
      <div
        role="group"
        aria-label="Set up sync"
        style={{ marginLeft: indent }}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep app shortcuts and the tree out
          if (e.key === "Escape") {
            e.preventDefault();
            // While setup runs the card stays, so its error can't be lost.
            if (!running) onCancel();
          } else if (
            e.key === "Enter" &&
            e.target instanceof HTMLInputElement
          ) {
            e.preventDefault();
            submit();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="z-fade-in my-1 mr-1 rounded-float bg-surface px-2.5 py-2.5 text-ui whitespace-normal text-text shadow-float"
      >
        <label htmlFor={id} className="block text-ui-sm text-muted">
          Remote URL
        </label>
        <input
          id={id}
          autoFocus
          value={url}
          spellCheck={false}
          autoComplete="off"
          placeholder="git@github.com:you/notes.git"
          onChange={(e) => setUrl(e.target.value)}
          className="mt-1 h-[26px] w-full min-w-0 rounded-[5px] bg-sunken px-2 font-mono text-ui-sm text-text shadow-[0_0_0_1px_var(--z-hairline)] outline-none placeholder:text-faint focus:shadow-[0_0_0_1px_var(--z-accent)]"
        />
        <p className="m-0 mt-1.5 text-ui-sm text-faint">
          Create an empty repo on GitHub, GitLab or your server, then paste its
          URL.
        </p>
        <p className="m-0 mt-1 text-ui-sm text-muted">
          Everything in this folder will be committed and pushed.
        </p>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={empty || running}
            onClick={submit}
            className="rounded-[6px] bg-accent px-2.5 py-1 font-medium text-accent-fg hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
          >
            {running ? "Setting up…" : "Set up"}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={onCancel}
            className="rounded-[6px] px-2.5 py-1 text-muted hover:bg-row-hover hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            Cancel
          </button>
        </div>
      </div>
      {error && <GitErrorBox error={error} indent={indent} />}
    </>
  );
}
