import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  asGitError,
  gitPickCloneParent,
  type CloneRequest,
  type GitError,
  type PickedParent,
} from "../git/api";
import { repoName } from "../git/messages";
import { GitErrorBox } from "./git/GitErrorBox";

/** What the dialog asks for; the caller adds the op id and held paths. */
export type CloneForm = Omit<CloneRequest, "opId" | "openPaths">;

/** The fields a failed clone reopens with, and its error. */
export interface CloneInitial {
  url: string;
  name: string;
  useAsLibrary: boolean;
  parent: PickedParent | null;
  error: GitError | null;
}

export interface CloneDialogProps {
  initial?: CloneInitial;
  /** `shown` keeps what the dialog needs to reopen after a failure. */
  onClone(req: CloneForm, shown: { name: string; parent: PickedParent }): void;
  onCancel(): void;
}

const BUTTON = "rounded-[6px] px-3 py-1 font-medium";
const FIELD =
  "h-[28px] w-full min-w-0 rounded-[5px] bg-sunken px-2 text-ui text-text shadow-[0_0_0_1px_var(--z-hairline)] outline-none placeholder:text-faint focus:shadow-[0_0_0_1px_var(--z-accent)]";
const LABEL = "mb-1 block text-ui-sm text-muted";

/** `parent` joined with `name`, in the parent's own separator. */
function destination(parent: string, name: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return parent.replace(/[/\\]+$/, "") + sep + name;
}

/** Add folder from git… (spec 4.2): the repo, where it goes, and its name. */
export function CloneDialog({ initial, onClone, onCancel }: CloneDialogProps) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  // The name follows the URL until the user types their own.
  const [nameEdited, setNameEdited] = useState(
    initial !== undefined && initial.name !== repoName(initial.url),
  );
  const [useAsLibrary, setUseAsLibrary] = useState(
    initial?.useAsLibrary ?? false,
  );
  const [parent, setParent] = useState<PickedParent | null>(
    initial?.parent ?? null,
  );
  const [error, setError] = useState<GitError | null>(initial?.error ?? null);
  const [picking, setPicking] = useState(false);

  const trimmedUrl = url.trim();
  const trimmedName = name.trim();
  const ready = trimmedUrl !== "" && trimmedName !== "" && parent !== null;

  const clone = () => {
    if (!ready) return;
    onClone(
      { token: parent.token, url: trimmedUrl, name: trimmedName, useAsLibrary },
      { name: trimmedName, parent },
    );
  };

  const chooseLocation = () => {
    setPicking(true);
    gitPickCloneParent()
      .then((p) => {
        if (p) setParent(p);
      })
      .catch((e: unknown) => setError(asGitError(e)))
      .finally(() => setPicking(false));
  };

  // Keys stay in the dialog: no app shortcut runs behind it.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (
      e.key === "Enter" &&
      e.target instanceof HTMLInputElement &&
      e.target.type === "text"
    ) {
      e.preventDefault();
      clone();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(0_0_0/0.4)]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="z-clone-title"
        onKeyDown={onKeyDown}
        className="z-fade-in flex w-[min(440px,calc(100vw-32px))] flex-col gap-3 rounded-[12px] bg-surface p-5 text-ui text-text shadow-float outline-none"
      >
        <h2 id="z-clone-title" className="m-0 text-ui-lg font-semibold">
          Add folder from git
        </h2>
        <div>
          <label htmlFor="z-clone-url" className={LABEL}>
            Repo URL
          </label>
          <input
            id="z-clone-url"
            type="text"
            autoFocus
            value={url}
            spellCheck={false}
            autoComplete="off"
            placeholder="git@github.com:you/notes.git"
            onChange={(e) => {
              setUrl(e.target.value);
              if (!nameEdited) setName(repoName(e.target.value));
            }}
            className={FIELD + " font-mono text-ui-sm"}
          />
        </div>
        <div>
          <label htmlFor="z-clone-name" className={LABEL}>
            Folder name
          </label>
          <input
            id="z-clone-name"
            type="text"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="z-clone-dest" className={LABEL}>
            Destination
          </label>
          <div className="flex gap-2">
            <input
              id="z-clone-dest"
              type="text"
              readOnly
              tabIndex={-1}
              value={parent ? destination(parent.path, trimmedName) : ""}
              placeholder="Choose where to put it"
              title={parent ? destination(parent.path, trimmedName) : undefined}
              className={FIELD + " text-muted"}
            />
            <button
              type="button"
              disabled={picking}
              onClick={chooseLocation}
              className={`${BUTTON} shrink-0 whitespace-nowrap text-muted shadow-[0_0_0_1px_var(--z-hairline)] hover:bg-row-hover hover:text-text disabled:opacity-40`}
            >
              Choose location…
            </button>
          </div>
        </div>
        <label
          htmlFor="z-clone-library"
          className="flex items-center gap-2 text-ui text-text"
        >
          <input
            id="z-clone-library"
            type="checkbox"
            checked={useAsLibrary}
            onChange={(e) => setUseAsLibrary(e.target.checked)}
            className="accent-[var(--z-accent)]"
          />
          Use as my Library
        </label>
        {error && (
          <GitErrorBox error={error} onDismiss={() => setError(null)} />
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={!ready}
            onClick={clone}
            className={`${BUTTON} bg-accent text-accent-fg disabled:opacity-40`}
          >
            Clone
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={`${BUTTON} text-muted hover:bg-row-hover hover:text-text`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
