import { useEffect, useRef, useState } from "react";
import type { GitError, RepoStatus } from "../git/api";
import { defaultCommitMessage } from "../git/messages";
import type { GitOp } from "../git/useGitSync";
import { GitErrorBox, isTreeKey } from "./git/GitErrorBox";
import { GitButton, syncRules } from "./git/syncButtons";
import { Icon } from "./icons";

export interface GitRowProps {
  name: string;
  status: RepoStatus;
  running: GitOp | null;
  justDone: GitOp | null;
  error: GitError | null;
  /** Open files under this folder with edits not yet saved to disk. */
  unsaved: number;
  /** Left padding in px, matching the folder heading's children. */
  indent: number;
  onPull(): void;
  /** An empty message means "push only". */
  onCommit(message: string): void;
  onPush(): void;
  onSaveAll(): void;
  onDismiss(): void;
}

function CommitCard({
  indent,
  unsaved,
  onSubmit,
  onClose,
  onSaveAll,
  anchorRef,
}: {
  indent: number;
  unsaved: number;
  /** The Commit button: a press on it is the toggle, not a click-away. */
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onSubmit(message: string): void;
  onClose(): void;
  onSaveAll(): void;
}) {
  const [message, setMessage] = useState(() =>
    defaultCommitMessage(new Date()),
  );
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const empty = message.trim() === "";
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // Click-away: a press outside the card and its Commit button closes it.
  // (Blur is unreliable: WebKit buttons take no focus on click.)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (card.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  });
  const submit = () => {
    if (!empty) onSubmit(message.trim());
  };
  return (
    <div
      ref={card}
      role="group"
      aria-label="Commit"
      style={{ marginLeft: indent }}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep app shortcuts and the tree out
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Enter" && e.target === input.current) {
          e.preventDefault();
          submit();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="z-fade-in my-1 mr-1 rounded-float bg-surface px-2 py-2 text-ui whitespace-normal text-text shadow-float"
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={input}
          aria-label="Commit message"
          value={message}
          spellCheck={false}
          onChange={(e) => setMessage(e.target.value)}
          className="h-[26px] min-w-0 flex-1 rounded-[5px] bg-sunken px-2 text-ui-sm text-text shadow-[0_0_0_1px_var(--z-hairline)] outline-none focus:shadow-[0_0_0_1px_var(--z-accent)]"
        />
        <button
          type="button"
          aria-label="Commit changes"
          title="Commit and push"
          disabled={empty}
          onClick={submit}
          className="flex size-[26px] shrink-0 items-center justify-center rounded-[5px] bg-accent text-accent-fg hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
        >
          <Icon name="check" size={13} strokeWidth={2} />
        </button>
      </div>
      {unsaved > 0 && (
        <div className="mt-2 flex items-center gap-2 text-ui-sm text-muted">
          <span>
            {unsaved === 1
              ? "1 unsaved file won't be included"
              : `${unsaved} unsaved files won't be included`}
          </span>
          <button
            type="button"
            onClick={onSaveAll}
            className="rounded-[6px] px-2 py-0.5 text-text hover:bg-row-hover"
          >
            Save all
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The git line under a library folder's heading: branch, an amber dot when
 * there are uncommitted changes, and Pull / Commit / Push. Commit opens a small
 * inline card; a failure shows an inline box until dismissed.
 */
export function GitRow({
  name,
  status,
  running,
  justDone,
  error,
  unsaved,
  indent,
  onPull,
  onCommit,
  onPush,
  onSaveAll,
  onDismiss,
}: GitRowProps) {
  const [cardOpen, setCardOpen] = useState(false);
  const commitBtn = useRef<HTMLButtonElement>(null);
  const busy = running !== null || status.state !== "none";
  const rules = syncRules(status, running);

  const branch =
    (status.branch ?? status.head) +
    (status.state === "rebasing"
      ? " · rebasing"
      : status.state === "merging"
        ? " · merging"
        : "");

  const commitClick = () => {
    if (status.dirty) setCardOpen((o) => !o);
    else if (status.ahead > 0) onCommit("");
  };

  return (
    <>
      <div
        data-git-row
        role="group"
        aria-label={`${name} git`}
        style={{ paddingLeft: indent }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keep the tree's keys from the tree; app shortcuts still work.
          if (isTreeKey(e)) e.stopPropagation();
        }}
        className="flex h-[22px] items-center gap-1 pr-1.5 whitespace-nowrap"
      >
        <Icon name="gitBranch" size={12} className="text-faint opacity-75" />
        <span className="min-w-0 truncate text-ui-xs text-faint">{branch}</span>
        {status.dirty && (
          <span
            role="img"
            aria-label="Uncommitted changes"
            title="Uncommitted changes"
            className="size-[5px] shrink-0 rounded-full bg-warn"
          />
        )}
        <div className="ml-auto flex shrink-0 gap-px">
          <GitButton
            compact
            label="Pull"
            icon="gitPull"
            op="pull"
            running={running}
            justDone={justDone}
            rule={rules.pull}
            onClick={onPull}
          />
          <GitButton
            compact
            label="Commit"
            icon="gitCommit"
            op="commit"
            running={running}
            justDone={justDone}
            rule={rules.commit}
            active={cardOpen}
            buttonRef={commitBtn}
            onClick={commitClick}
          />
          <GitButton
            compact
            label="Push"
            icon="gitPush"
            op="push"
            running={running}
            justDone={justDone}
            rule={rules.push}
            onClick={onPush}
          />
        </div>
      </div>
      {cardOpen && status.dirty && !busy && (
        <CommitCard
          indent={indent}
          unsaved={unsaved}
          anchorRef={commitBtn}
          onClose={() => setCardOpen(false)}
          onSaveAll={onSaveAll}
          onSubmit={(m) => {
            setCardOpen(false);
            onCommit(m);
          }}
        />
      )}
      {error && (
        <GitErrorBox error={error} indent={indent} onDismiss={onDismiss} />
      )}
    </>
  );
}
