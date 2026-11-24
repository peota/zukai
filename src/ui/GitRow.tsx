import { useEffect, useRef, useState } from "react";
import type { GitError, RepoStatus } from "../git/api";
import { defaultCommitMessage, errorCopy } from "../git/messages";
import type { GitOp } from "../git/useGitSync";
import { CloseIcon, Icon, type IconName } from "./icons";

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

const NO_REMOTE = "No remote set up for this folder";
const REBASE_FIRST = "Finish the rebase in a terminal first";

const BTN =
  "relative flex size-5 shrink-0 items-center justify-center rounded-[4px] text-faint hover:bg-row-hover hover:text-muted aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-faint disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-faint";

function GitButton({
  label,
  icon,
  op,
  running,
  justDone,
  title,
  disabled,
  inert,
  active,
  onClick,
}: {
  label: string;
  icon: IconName;
  op: GitOp;
  running: GitOp | null;
  justDone: GitOp | null;
  title: string;
  /** Truly disabled: nothing can happen. */
  disabled: boolean;
  /** Looks disabled and ignores clicks, but keeps its tooltip. */
  inert: boolean;
  active?: boolean;
  onClick(): void;
}) {
  const spinning = running === op;
  const done = !spinning && justDone === op;
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      aria-disabled={inert || undefined}
      onClick={() => {
        if (!inert) onClick();
      }}
      className={BTN + (active ? " bg-accent-soft text-accent" : "")}
    >
      {spinning ? (
        <Icon
          name="spinner"
          size={13}
          className="animate-spin motion-reduce:animate-none"
        />
      ) : done ? (
        <Icon name="check" size={13} className="text-accent" />
      ) : (
        <Icon name={icon} size={13} />
      )}
    </button>
  );
}

function CommitCard({
  indent,
  unsaved,
  onSubmit,
  onClose,
  onSaveAll,
}: {
  indent: number;
  unsaved: number;
  onSubmit(message: string): void;
  onClose(): void;
  onSaveAll(): void;
}) {
  const [message, setMessage] = useState(() =>
    defaultCommitMessage(new Date()),
  );
  const input = useRef<HTMLInputElement>(null);
  const empty = message.trim() === "";
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = () => {
    if (!empty) onSubmit(message.trim());
  };
  return (
    <div
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
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          onClose();
      }}
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
  const busy = running !== null || status.state !== "none";
  const noOrigin = !status.origin;
  const nothingToPush = !status.dirty && status.upstream && status.ahead === 0;
  const nothingToCommit = !status.dirty && status.ahead === 0;

  const pullTitle =
    status.state !== "none" ? REBASE_FIRST : noOrigin ? NO_REMOTE : "Pull";
  const pushTitle = noOrigin
    ? NO_REMOTE
    : nothingToPush
      ? "Nothing to push"
      : "Push";
  const commitTitle = nothingToCommit ? "Nothing to commit" : "Commit";

  const branch =
    (status.branch ?? "head") +
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
        onKeyDown={(e) => e.stopPropagation()}
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
            label="Pull"
            icon="gitPull"
            op="pull"
            running={running}
            justDone={justDone}
            title={pullTitle}
            disabled={busy || noOrigin || !status.upstream}
            inert={false}
            onClick={onPull}
          />
          <GitButton
            label="Commit"
            icon="gitCommit"
            op="commit"
            running={running}
            justDone={justDone}
            title={commitTitle}
            disabled={busy}
            inert={nothingToCommit}
            active={cardOpen}
            onClick={commitClick}
          />
          <GitButton
            label="Push"
            icon="gitPush"
            op="push"
            running={running}
            justDone={justDone}
            title={pushTitle}
            disabled={busy || noOrigin}
            inert={nothingToPush}
            onClick={onPush}
          />
        </div>
      </div>
      {cardOpen && status.dirty && !busy && (
        <CommitCard
          indent={indent}
          unsaved={unsaved}
          onClose={() => setCardOpen(false)}
          onSaveAll={onSaveAll}
          onSubmit={(m) => {
            setCardOpen(false);
            onCommit(m);
          }}
        />
      )}
      {error && (
        <div
          role="alert"
          style={{ marginLeft: indent }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="z-fade-in my-1 mr-1 flex items-start gap-1.5 rounded-float bg-surface px-2.5 py-1.5 text-ui-sm whitespace-normal text-danger shadow-float"
        >
          <div className="min-w-0 flex-1">
            <div>{errorCopy(error)}</div>
            {error.detail && error.detail !== errorCopy(error) && (
              <div className="mt-1 font-mono text-ui-xs break-words text-muted">
                {error.detail}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={onDismiss}
            className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-faint hover:bg-row-hover hover:text-text"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      )}
    </>
  );
}
