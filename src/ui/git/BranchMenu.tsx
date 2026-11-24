import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { GitSyncApi } from "../../git/useGitSync";
import { Icon } from "../icons";
import { MENU_PANEL, menuRow } from "../Menu";
import { REBASE_FIRST } from "./syncButtons";

/** More branches than this in total and the menu gets a filter field. */
const FILTER_ABOVE = 8;

const DIRTY = "You have uncommitted changes. Commit first, then switch.";
const unsavedCopy = (n: number) =>
  `Save or close ${n} unsaved ${n === 1 ? "file" : "files"} first.`;

/**
 * git's branch-name rules, the quick ones (Rust's `check-ref-format` stays
 * authoritative): not empty, no leading `-`, no `..`, whitespace, control
 * characters or any of `~^:?*[\`, no `@{`, not `@`, and no trailing
 * `.lock`, `/` or `.`.
 */
export function branchNameValid(name: string): boolean {
  if (name === "" || name === "@") return false;
  if (name.startsWith("-")) return false;
  if (name.includes("..") || name.includes("@{")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f~^:?*[\\]/.test(name)) return false;
  return !(name.endsWith(".lock") || name.endsWith("/") || name.endsWith("."));
}

type Option =
  | { kind: "new" }
  | { kind: "local"; name: string }
  | { kind: "remote"; name: string };

export interface BranchMenuProps {
  folder: string;
  /** The branch button's box; the menu hangs below it. */
  anchor: DOMRect;
  git: GitSyncApi;
  /** Open tabs under `folder` with edits not yet on disk. */
  unsaved: number;
  onSaveAll(): void;
  onClose(): void;
}

/**
 * The branch menu (spec 4.5): New branch…, LOCAL and ON REMOTE, with a
 * filter past 8 branches. Switching is refused here, with nothing run,
 * while the folder has uncommitted changes or unsaved tabs; creating a
 * branch is not, since it touches no file.
 */
export function BranchMenu({
  folder,
  anchor,
  git,
  unsaved,
  onSaveAll,
  onClose,
}: BranchMenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(-1);
  /** The new branch's name while the inline field shows, else null. */
  const [naming, setNaming] = useState<string | null>(null);
  /** Why the last switch was refused; the unsaved one goes once they're saved. */
  const [refused, setRefused] = useState<"unsaved" | "dirty" | null>(null);
  const showUnsaved = refused === "unsaved" && unsaved > 0;
  const saveAllRef = useRef<HTMLButtonElement>(null);
  const [shift, setShift] = useState(0);

  const status = git.status(folder);
  const repo = status?.kind === "repo" ? status : null;
  const inProgress = repo !== null && repo.state !== "none";
  const off = inProgress || git.running(folder) !== null;
  const branches = git.branches(folder);
  const current = branches?.current ?? null;
  const total = branches
    ? branches.local.length + branches.remoteOnly.length
    : 0;
  const filtering = total > FILTER_ABOVE;
  const q = filtering ? filter.trim().toLowerCase() : "";
  const match = (n: string) => n.toLowerCase().includes(q);
  const local = (branches?.local ?? []).filter((b) => match(b.name));
  const remote = (branches?.remoteOnly ?? []).filter(match);
  const options: Option[] = [
    { kind: "new" },
    ...local.map((b): Option => ({ kind: "local", name: b.name })),
    ...remote.map((name): Option => ({ kind: "remote", name })),
  ];

  // Outside presses close it; the branch button toggles it itself.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (root.current?.contains(t)) return;
      if (t.closest?.("[data-z-git-branch]")) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Focus the filter (or the menu) on open and after leaving the name field.
  const named = naming !== null;
  useLayoutEffect(() => {
    if (named) return;
    (filterRef.current ?? panel.current)?.focus({ preventScroll: true });
  }, [named]);

  // Keep it on screen, again whenever its height can change.
  const shiftRef = useRef(0);
  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (!r) return;
    const bottom = r.bottom - shiftRef.current;
    const next = Math.min(0, window.innerHeight - 8 - bottom);
    if (next !== shiftRef.current) {
      shiftRef.current = next;
      setShift(next);
    }
  }, [branches, named, refused, filter]);

  // The unsaved refusal hands focus to its Save all, and takes it back to
  // the menu once that's done.
  const hadSaveAll = useRef(false);
  useEffect(() => {
    if (showUnsaved) {
      hadSaveAll.current = true;
      saveAllRef.current?.focus({ preventScroll: true });
    } else if (hadSaveAll.current) {
      hadSaveAll.current = false;
      if (!root.current?.contains(document.activeElement)) {
        panel.current?.focus({ preventScroll: true });
      }
    }
  }, [showUnsaved]);

  const choose = (o: Option | undefined) => {
    if (!o || off) return;
    setRefused(null);
    if (o.kind === "new") {
      setNaming(filter.trim());
      return;
    }
    if (o.kind === "local" && o.name === current) return onClose();
    if (unsaved > 0) {
      setRefused("unsaved");
      return;
    }
    if (repo?.dirty) {
      setRefused("dirty");
      return;
    }
    onClose();
    void git.switchBranch(folder, o.name, o.kind === "remote");
  };

  const step = (dir: 1 | -1) => {
    const n = options.length;
    if (off || n === 0) return;
    const from = active < 0 ? (dir === 1 ? -1 : 0) : active;
    setActive((((from + dir) % n) + n) % n);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (naming !== null) return; // the name field handles its own keys
    if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "Enter") choose(options[active]);
    else if (e.key === "Escape" || e.key === "Tab") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const style: CSSProperties = {
    position: "fixed",
    left: anchor.left,
    top: anchor.bottom + 4 + shift,
  };

  const row = (o: Option, i: number, lead: ReactNode, label: ReactNode) => (
    <div
      key={o.kind === "new" ? "new" : `${o.kind}:${o.name}`}
      role={o.kind === "new" ? "menuitem" : "menuitemradio"}
      aria-checked={
        o.kind === "new" ? undefined : o.kind === "local" && o.name === current
      }
      aria-disabled={off || undefined}
      onMouseEnter={() => !off && setActive(i)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => choose(o)}
      className={menuRow(i === active, off, "center")}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-accent">
        {lead}
      </span>
      <span
        className="min-w-0 flex-1 truncate"
        title={o.kind === "new" ? undefined : o.name}
      >
        {label}
      </span>
    </div>
  );

  const heading = (text: string) => (
    <div
      aria-hidden
      className="px-2.5 pt-2 pb-1 text-ui-xs font-semibold tracking-[0.04em] text-faint"
    >
      {text}
    </div>
  );

  return (
    <div ref={root} style={style} className="z-40">
      <div
        ref={panel}
        role="menu"
        aria-label="Branches"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={MENU_PANEL + " w-64"}
      >
        {naming !== null ? (
          <NameField
            value={naming}
            taken={
              branches?.local.some((b) => b.name === naming.trim()) ?? false
            }
            onChange={setNaming}
            onCreate={(name) => {
              onClose();
              void git.createBranch(folder, name);
            }}
            onBack={() => setNaming(null)}
            onLeave={onClose}
          />
        ) : (
          <>
            {filtering && (
              <div className="relative mb-1">
                <Icon
                  name="search"
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
                />
                <input
                  ref={filterRef}
                  value={filter}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Find or create a branch"
                  aria-label="Filter branches"
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setActive(-1);
                  }}
                  onKeyDown={(e) => {
                    // Arrows, Enter and Esc go to the menu; the rest stays here.
                    if (
                      ![
                        "ArrowDown",
                        "ArrowUp",
                        "Enter",
                        "Escape",
                        "Tab",
                      ].includes(e.key)
                    ) {
                      e.stopPropagation();
                    } else if (e.key === "Enter" && active < 0 && q !== "") {
                      // Enter picks the first match, else starts a new branch.
                      e.preventDefault();
                      e.stopPropagation();
                      choose(options[1] ?? options[0]);
                    }
                  }}
                  className="h-8 w-full rounded-[6px] border border-hairline bg-sunken pr-2.5 pl-8 text-text outline-none placeholder:text-faint focus:border-accent"
                />
              </div>
            )}
            {row(
              options[0],
              0,
              <Icon name="plus" size={15} className="text-faint" />,
              "New branch…",
            )}
          </>
        )}
        {inProgress && (
          <p className="m-0 px-2.5 py-1.5 text-ui-sm text-faint">
            {REBASE_FIRST}
          </p>
        )}
        {(showUnsaved || refused === "dirty") && (
          <p role="alert" className="m-0 px-2.5 py-1.5 text-ui-sm text-muted">
            {refused === "dirty" ? (
              DIRTY
            ) : (
              <>
                {unsavedCopy(unsaved)}{" "}
                <button
                  ref={saveAllRef}
                  type="button"
                  onClick={onSaveAll}
                  onKeyDown={(e) => {
                    // Enter and Space press the button, not the menu's row.
                    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                  }}
                  className="rounded-[4px] text-accent underline-offset-2 hover:underline"
                >
                  Save all
                </button>
              </>
            )}
          </p>
        )}
        <div className="max-h-[min(360px,60vh)] overflow-y-auto">
          {branches === undefined ? (
            <div className="px-2.5 py-[6px] text-faint">Reading branches…</div>
          ) : local.length + remote.length === 0 ? (
            q !== "" && (
              <div className="px-2.5 py-[6px] text-faint">
                No matching branches
              </div>
            )
          ) : null}
          {local.length > 0 && (
            <div role="group" aria-label="Local">
              {heading("LOCAL")}
              {local.map((b, k) =>
                row(
                  options[1 + k],
                  1 + k,
                  b.name === current && (
                    <Icon name="check" size={15} strokeWidth={2} />
                  ),
                  b.name,
                ),
              )}
            </div>
          )}
          {remote.length > 0 && (
            <div role="group" aria-label="On remote">
              {heading("ON REMOTE")}
              {remote.map((name, k) =>
                row(
                  options[1 + local.length + k],
                  1 + local.length + k,
                  null,
                  <>
                    <span className="text-faint">origin/</span>
                    {name}
                  </>,
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** New branch…'s inline field: checked as you type, Enter creates. */
function NameField({
  value,
  taken,
  onChange,
  onCreate,
  onBack,
  onLeave,
}: {
  value: string;
  taken: boolean;
  onChange(v: string): void;
  onCreate(name: string): void;
  /** Esc: back to the list. */
  onBack(): void;
  /** Tab: close the menu. */
  onLeave(): void;
}) {
  const name = value.trim();
  const problem =
    name === ""
      ? null
      : !branchNameValid(name)
        ? "Not a valid branch name"
        : taken
          ? "That branch already exists"
          : null;
  return (
    <div className="mb-1">
      <input
        autoFocus
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="New branch name"
        aria-label="Branch name"
        aria-invalid={problem !== null || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep app shortcuts and the menu's keys out
          if (e.key === "Enter") {
            e.preventDefault();
            if (name !== "" && problem === null) onCreate(name);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onBack();
          } else if (e.key === "Tab") {
            // Like the menu itself: Tab leaves and closes it.
            e.preventDefault();
            onLeave();
          }
        }}
        className="h-8 w-full rounded-[6px] border border-hairline bg-sunken px-2.5 text-text outline-none placeholder:text-faint focus:border-accent aria-invalid:border-danger"
      />
      <p
        className={
          "m-0 px-0.5 pt-1.5 pb-0.5 text-ui-sm " +
          (problem ? "text-danger" : "text-faint")
        }
      >
        {problem ?? "Enter creates it here and switches to it."}
      </p>
    </div>
  );
}
