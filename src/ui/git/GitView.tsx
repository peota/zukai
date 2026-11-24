import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RepoStatus } from "../../git/api";
import type { GitSyncApi } from "../../git/useGitSync";
import type { DiffTarget } from "../../model/types";
import { Icon, MoreIcon } from "../icons";
import { Menu } from "../Menu";
import { ChangesList } from "./ChangesList";
import { CommitBox } from "./CommitBox";
import { FolderPicker, type GitFolder } from "./FolderPicker";
import { GitErrorBox } from "./GitErrorBox";
import { GitButton, syncRules } from "./syncButtons";

/** What the branch menu (Task 7) gets when the branch button opens it. */
export interface BranchMenuSlot {
  folder: string;
  /** The branch button's box, to hang the menu from. */
  anchor: DOMRect;
  /**
   * Closes the menu. The button carries `data-z-git-branch`, so an
   * outside-press handler can ignore it and let the button toggle.
   */
  close(): void;
}

export interface GitViewProps {
  git: GitSyncApi;
  /** The Library root first, then the added folders. */
  folders: GitFolder[];
  /**
   * Selected first (the folder last picked this session, else the active
   * tab's, else the Library root); a new value selects it.
   */
  defaultFolder: string | null;
  /** A folder picked in the view, to come back to next time. */
  onSelectFolder?(folder: string): void;
  unsavedUnder(folder: string): number;
  onSaveAll(): void;
  onOpenDiff(target: DiffTarget): void;
  /** Absolute paths. */
  onOpenFile(path: string): void;
  onCopyPath(path: string): void;
  /** Opens the existing CloneDialog. */
  onAddFromGit(): void;
  renderBranchMenu?(slot: BranchMenuSlot): ReactNode;
}

const LOADING_DELAY_MS = 300;

/** True once `on` has held for `ms`, so quick answers never flash a spinner. */
function useDelayed(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  // Off again: forget the wait, so the next one starts from zero.
  if (!on && late) setLate(false);
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setLate(true), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return on && late;
}

/**
 * The Git view (spec 4.3–4.4): the folder, its branch with Pull and Push, the
 * commit box and the changes list. A folder that isn't a repo gets the Set
 * up sync form instead; without git there is one line and nothing else.
 */
export function GitView({
  git,
  folders,
  defaultFolder,
  onSelectFolder,
  unsavedUnder,
  onSaveAll,
  onOpenDiff,
  onOpenFile,
  onCopyPath,
  onAddFromGit,
  renderBranchMenu,
}: GitViewProps) {
  const [chosen, setChosen] = useState(defaultFolder);
  // A new default (another active tab's folder, or the status bar's chip)
  // wins; none (a scratchpad active) keeps what shows.
  const [seenDefault, setSeenDefault] = useState(defaultFolder);
  if (defaultFolder !== seenDefault) {
    setSeenDefault(defaultFolder);
    if (defaultFolder !== null) setChosen(defaultFolder);
  }
  const choose = (f: string) => {
    setChosen(f);
    onSelectFolder?.(f);
  };
  const has = (f: string | null) => folders.some((x) => x.path === f);
  const folder = has(chosen)
    ? chosen
    : has(defaultFolder)
      ? defaultFolder
      : (folders[0]?.path ?? null);

  const { select } = git;
  // Only the shown folder's changes and branches are read (spec 4.7).
  useEffect(() => {
    if (folder === null) return;
    select(folder);
    return () => select(null);
  }, [folder, select]);

  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const status = folder === null ? undefined : git.status(folder);
  const slow = useDelayed(
    git.available && status === undefined,
    LOADING_DELAY_MS,
  );

  if (!git.available) {
    return (
      <p className="m-0 px-2 py-1 text-muted">Install git to sync folders.</p>
    );
  }
  if (folder === null) return null;

  const error = git.error(folder);
  const dismiss = () => git.dismiss(folder);

  let body: ReactNode;
  if (status === undefined) {
    body = slow && (
      <div className="flex items-center gap-2 px-2 py-1 text-faint">
        <Icon
          name="spinner"
          size={14}
          className="animate-spin motion-reduce:animate-none"
        />
        <span>Reading git status…</span>
      </div>
    );
  } else if (status.kind === "notRepo") {
    body = (
      <>
        <SetupForm
          key={folder}
          running={git.running(folder) === "setup"}
          onSetUp={(url) => void git.setup(folder, url)}
        />
        {error && <GitErrorBox error={error} onDismiss={dismiss} />}
      </>
    );
  } else if (status.kind === "insideRepo") {
    body = (
      <p className="m-0 px-2 py-1 text-muted">
        This folder is inside the git repo at {status.top}.
      </p>
    );
  } else {
    body = (
      <>
        <BranchRow
          git={git}
          folder={folder}
          status={status}
          renderBranchMenu={renderBranchMenu}
        />
        {error && <GitErrorBox error={error} onDismiss={dismiss} />}
        <div className="mx-1 mt-1 h-px shrink-0 bg-hairline" />
        <CommitBox
          key={folder}
          git={git}
          folder={folder}
          status={status}
          unsaved={unsavedUnder(folder)}
          onSaveAll={onSaveAll}
        />
        <ChangesList
          folder={folder}
          changes={git.changes(folder)}
          onOpenDiff={onOpenDiff}
          onOpenFile={onOpenFile}
          onCopyPath={onCopyPath}
        />
      </>
    );
  }

  return (
    <div
      aria-label="Git"
      role="region"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-[30px] shrink-0 items-center gap-0.5 pr-0.5">
        <FolderPicker
          folders={folders}
          selected={folder}
          statusOf={git.status}
          onSelect={choose}
        />
        <span className="flex-1" />
        <button
          ref={moreRef}
          type="button"
          aria-label="Git actions"
          title="Git actions"
          data-z-git-more=""
          onClick={() => {
            if (more) return setMore(null);
            const b = moreRef.current?.getBoundingClientRect();
            setMore({ x: b?.right ?? 0, y: (b?.bottom ?? 0) + 4 });
          }}
          className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
        >
          <MoreIcon />
        </button>
      </div>
      {body}
      {more && (
        <Menu
          label="Git"
          x={more.x}
          y={more.y}
          align="end"
          ignoreSelector="[data-z-git-more]"
          items={[
            { label: "Add folder from git…", onSelect: onAddFromGit },
            { label: "Refresh", onSelect: () => git.refresh() },
          ]}
          onDismiss={() => {
            setMore(null);
            moreRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

function BranchRow({
  git,
  folder,
  status,
  renderBranchMenu,
}: {
  git: GitSyncApi;
  folder: string;
  status: RepoStatus;
  renderBranchMenu?: GitViewProps["renderBranchMenu"];
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const branchRef = useRef<HTMLButtonElement>(null);
  const running = git.running(folder);
  const justDone = git.justDone(folder);
  const rules = syncRules(status, running);
  const close = () => setMenu(null);
  // Focus goes back to the button when the menu closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (menu) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      branchRef.current?.focus({ preventScroll: true });
    }
  }, [menu]);

  return (
    <div className="flex h-[30px] shrink-0 items-center gap-1 pr-0.5 whitespace-nowrap">
      <button
        ref={branchRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        data-z-git-branch=""
        onClick={() => {
          if (menu) return close();
          const b = branchRef.current?.getBoundingClientRect();
          if (b) setMenu(b);
        }}
        className="flex h-[26px] min-w-0 items-center gap-1.5 rounded-[6px] px-2 text-muted hover:bg-row-hover hover:text-text"
      >
        <Icon name="gitBranch" className="text-faint" />
        <span className="min-w-0 truncate">{status.branch ?? status.head}</span>
        <Icon name="chevronDown" size={14} className="text-faint" />
      </button>
      {status.state !== "none" && (
        <span className="shrink-0 text-ui-sm text-muted">{status.state}</span>
      )}
      <span className="flex-1" />
      {status.behind > 0 && (
        <Count icon="arrowDown" n={status.behind} label="behind" />
      )}
      {status.ahead > 0 && (
        <Count icon="arrowUp" n={status.ahead} label="ahead" />
      )}
      <GitButton
        label="Pull"
        icon="gitPull"
        op="pull"
        running={running}
        justDone={justDone}
        rule={rules.pull}
        onClick={() => void git.pull(folder)}
      />
      <GitButton
        label="Push"
        icon="gitPush"
        op="push"
        running={running}
        justDone={justDone}
        rule={rules.push}
        onClick={() => void git.push(folder)}
      />
      {menu && renderBranchMenu?.({ folder, anchor: menu, close })}
    </div>
  );
}

function Count({
  icon,
  n,
  label,
}: {
  icon: "arrowDown" | "arrowUp";
  n: number;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${n} ${label}`}
      title={`${n} ${n === 1 ? "commit" : "commits"} ${label}`}
      className="flex shrink-0 items-center text-ui-sm text-faint tabular-nums"
    >
      <Icon name={icon} size={13} />
      <span aria-hidden="true">{n}</span>
    </span>
  );
}

/** Set up sync (sync spec 4.1), inline in the view's empty state. */
function SetupForm({
  running,
  onSetUp,
}: {
  running: boolean;
  onSetUp(url: string): void;
}) {
  const [url, setUrl] = useState("");
  const id = useId();
  const empty = url.trim() === "";
  const submit = () => {
    if (!empty && !running) onSetUp(url.trim());
  };
  return (
    <div className="px-2 pt-1">
      <p className="m-0 text-muted">This folder isn't synced yet.</p>
      <label htmlFor={id} className="mt-3 block text-ui-sm text-muted">
        Remote URL
      </label>
      <input
        id={id}
        value={url}
        spellCheck={false}
        autoComplete="off"
        placeholder="git@github.com:you/notes.git"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep app shortcuts out of the field
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="mt-1 h-[28px] w-full min-w-0 rounded-[6px] bg-sunken px-2 text-ui-sm text-text shadow-[0_0_0_1px_var(--z-hairline)] outline-none placeholder:text-faint focus:shadow-[0_0_0_1px_var(--z-accent)]"
      />
      <p className="m-0 mt-1.5 text-ui-sm text-faint">
        Create an empty repo on GitHub, GitLab or your server, then paste its
        URL.
      </p>
      <p className="m-0 mt-1 text-ui-sm text-muted">
        Everything in this folder will be committed and pushed.
      </p>
      <button
        type="button"
        disabled={empty || running}
        onClick={submit}
        className="mt-2.5 rounded-[6px] bg-accent px-2.5 py-1 font-medium text-accent-fg hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
      >
        {running ? "Setting up…" : "Set up"}
      </button>
    </div>
  );
}
