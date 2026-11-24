import type { RepoStatus } from "../../git/api";
import type { GitOp } from "../../git/useGitSync";
import { Icon, type IconName } from "../icons";

export const NO_REMOTE = "No remote set up for this folder";
export const REBASE_FIRST = "Finish the rebase in a terminal first";
export const PUSH_FIRST = "Push first to connect this folder to its remote.";

export interface ButtonRule {
  title: string;
  /** Truly disabled: nothing can happen. */
  disabled: boolean;
  /** Looks disabled and ignores clicks, but keeps its tooltip. */
  inert: boolean;
}

/**
 * Pull, Commit and Push enablement and tooltips (sync spec 4.4–4.6): one op
 * at a time, nothing during a rebase or merge, Pull needs an upstream, Push
 * needs `origin`, and an action with nothing to do keeps saying so.
 */
export function syncRules(
  status: RepoStatus,
  running: GitOp | null,
): { pull: ButtonRule; commit: ButtonRule; push: ButtonRule } {
  const inProgress = status.state !== "none";
  const busy = running !== null || inProgress;
  const noOrigin = !status.origin;
  const nothingToPush = !status.dirty && status.upstream && status.ahead === 0;
  const nothingToCommit = !status.dirty && status.ahead === 0;
  return {
    pull: {
      title: inProgress
        ? REBASE_FIRST
        : noOrigin
          ? NO_REMOTE
          : !status.upstream
            ? PUSH_FIRST
            : "Pull",
      disabled: busy || noOrigin || !status.upstream,
      inert: false,
    },
    commit: {
      title: inProgress
        ? REBASE_FIRST
        : nothingToCommit
          ? "Nothing to commit"
          : "Commit",
      disabled: busy,
      inert: nothingToCommit,
    },
    push: {
      title: inProgress
        ? REBASE_FIRST
        : noOrigin
          ? NO_REMOTE
          : nothingToPush
            ? "Nothing to push"
            : "Push",
      disabled: busy || noOrigin,
      inert: nothingToPush,
    },
  };
}

const BASE =
  "relative flex shrink-0 items-center justify-center text-faint hover:bg-row-hover hover:text-muted aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-faint disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-faint";

/**
 * A git icon button that spins while its op runs and shows a check for a
 * moment after. `compact` is the old 20px library row; the Git view's are 24px.
 */
export function GitButton({
  label,
  icon,
  op,
  running,
  justDone,
  rule,
  active,
  compact,
  buttonRef,
  onClick,
}: {
  label: string;
  icon: IconName;
  op: GitOp;
  running: GitOp | null;
  justDone: GitOp | null;
  rule: ButtonRule;
  active?: boolean;
  compact?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick(): void;
}) {
  const spinning = running === op;
  const done = !spinning && justDone === op;
  const size = compact ? 13 : 16;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={rule.title}
      disabled={rule.disabled}
      aria-disabled={rule.inert || undefined}
      onClick={() => {
        if (!rule.inert) onClick();
      }}
      className={
        BASE +
        (compact ? " size-5 rounded-[4px]" : " size-6 rounded-[5px]") +
        (active ? " bg-accent-soft text-accent" : "")
      }
    >
      {spinning ? (
        <Icon
          name="spinner"
          size={size}
          className="animate-spin motion-reduce:animate-none"
        />
      ) : done ? (
        <Icon name="check" size={size} className="text-accent" />
      ) : (
        <Icon name={icon} size={size} />
      )}
    </button>
  );
}
