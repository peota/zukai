import { useLayoutEffect, useRef, useState } from "react";
import type { RepoStatus } from "../../git/api";
import { defaultCommitMessage } from "../../git/messages";
import type { GitSyncApi } from "../../git/useGitSync";
import { Icon } from "../icons";
import { syncRules } from "./syncButtons";

export interface CommitBoxProps {
  git: GitSyncApi;
  folder: string;
  status: RepoStatus;
  /** Open files under the folder with edits not yet saved to disk. */
  unsaved: number;
  onSaveAll(): void;
}

/**
 * The Git view's commit box (spec 4.3): a multi-line message that defaults to
 * `Sync YYYY-MM-DD`, and Commit & push (Commit without a remote). The message
 * clears once the commit lands, and stays when it fails.
 */
export function CommitBox({
  git,
  folder,
  status,
  unsaved,
  onSaveAll,
}: CommitBoxProps) {
  const [message, setMessage] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const running = git.running(folder);
  const justDone = git.justDone(folder);
  const landed = git.error(folder)?.committed === true;
  const placeholder = defaultCommitMessage(new Date());
  const rule = syncRules(status, running).commit;
  const disabled = rule.disabled || !status.dirty;
  const title =
    status.state !== "none"
      ? rule.title
      : !status.dirty
        ? "Nothing to commit"
        : status.origin
          ? "Commit and push"
          : "Commit";

  // The commit landed (even if its push then failed): start fresh.
  const outcome = `${justDone === "commit"}|${landed}`;
  const [seen, setSeen] = useState(outcome);
  if (seen !== outcome) {
    setSeen(outcome);
    if (justDone === "commit" || landed) setMessage("");
  }

  // Grows with its text up to four lines (max-height), then scrolls.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [message]);

  const submit = () => {
    if (disabled) return;
    void git.commit(folder, message.trim() || placeholder);
  };

  return (
    <div className="shrink-0 px-1 pt-2 pb-1">
      <textarea
        ref={field}
        aria-label="Commit message"
        rows={1}
        value={message}
        placeholder={placeholder}
        // While the commit runs: it clears when it lands, so typing waits.
        readOnly={running === "commit"}
        spellCheck={false}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep app shortcuts out of the field
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        className="block max-h-[calc(4lh+12px)] min-h-[30px] w-full resize-none overflow-y-auto rounded-[6px] bg-sunken px-2 py-1.5 text-ui leading-[1.4] text-text shadow-[0_0_0_1px_var(--z-hairline)] outline-none placeholder:text-faint read-only:text-muted focus:shadow-[0_0_0_1px_var(--z-accent)]"
      />
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={submit}
        className="mt-2 flex h-7 items-center gap-1.5 rounded-[6px] bg-accent px-2.5 font-medium text-accent-fg hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
      >
        {running === "commit" && (
          <Icon
            name="spinner"
            size={14}
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {status.origin ? "Commit & push" : "Commit"}
      </button>
      {unsaved > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-1 text-ui-sm text-muted">
          <span>
            {unsaved === 1
              ? "1 unsaved file won't be included"
              : `${unsaved} unsaved files won't be included`}
          </span>
          <span aria-hidden="true" className="text-faint">
            ·
          </span>
          <button
            type="button"
            onClick={onSaveAll}
            className="rounded-[4px] text-text underline-offset-2 hover:underline"
          >
            Save all
          </button>
        </div>
      )}
    </div>
  );
}
