/**
 * Dev-only browser preview: fakes the Rust side (Tauri IPC) with an in-memory
 * notebook so the UI can be seen and designed in a plain browser at
 * http://localhost:1420/preview.html. Never part of the app build.
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const ROOT = "C:\\Users\\dev\\Zukai";
const sep = "\\";
const join = (a: string, b: string) => `${a}${sep}${b}`;

const md = `# Redis failover, 12 Nov

Primary in **eu-west-1b** stopped answering at 14:02. Sentinel promoted the
replica after 31s, but the app kept a pooled connection to the old primary.

## What we tried

- [x] Confirm the replica was promoted: \`redis-cli -p 26379 sentinel get-master-addr-by-name cache\`
- [x] Restart the checkout workers
- [ ] Lower \`socket_timeout\` in the pool to 2s
- [ ] Add a failover drill to the runbook

## Timeline

| Time  | Event                          | Owner |
| ----- | ------------------------------ | ----- |
| 14:02 | p99 on /checkout jumps to 4.1s | alert |
| 14:03 | Sentinel marks primary down    | auto  |
| 14:09 | Workers restarted              | Dana  |
| 14:11 | Latency back to normal         |       |

> The pool never re-resolved the master. That's the real bug.

\`\`\`python
pool = redis.ConnectionPool(
    host=sentinel.discover_master("cache")[0],
    socket_timeout=2,
    health_check_interval=10,
)
\`\`\`
`;

const sh = `#!/usr/bin/env bash
# Things I keep looking up.

# Pods sorted by restarts
kubectl get pods -A --sort-by='.status.containerStatuses[0].restartCount'

# Tail a deployment across all pods
kubectl logs -f deploy/checkout --all-containers --since=10m

# Port-forward the read replica
kubectl port-forward svc/postgres-replica 5433:5432 -n data

# Which process holds a port
lsof -iTCP:8080 -sTCP:LISTEN
`;

const sql = `-- Slowest queries in the last day (pg_stat_statements)
SELECT
  round(mean_exec_time::numeric, 1) AS mean_ms,
  calls,
  left(query, 120) AS query
FROM pg_stat_statements
WHERE calls > 50
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Bloated indexes
SELECT schemaname, relname, indexrelname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
`;

const json = `{
  "id": "evt_01JD3K8Q2V",
  "type": "order.paid",
  "created": "2026-11-12T14:09:31Z",
  "data": {
    "order_id": 48213,
    "amount": { "value": 12900, "currency": "EUR" },
    "items": [
      { "sku": "KB-75-BRN", "qty": 1 },
      { "sku": "CBL-USBC-1M", "qty": 2 }
    ],
    "retry": false
  }
}
`;

const csv = `endpoint,p50_ms,p95_ms,p99_ms,requests,errors
/checkout,182,640,4100,18234,41
/cart,64,210,380,52011,3
/search,95,310,720,88120,12
/product/:id,41,120,260,140932,0
/login,120,300,510,9120,7
`;

const notes = `Onboarding notes

- VPN: use the "eng" profile, not "corp"
- Staging DB is read-only for us; ask #data for writes
- Feature flags live in flags.yaml, deployed with the service
- On-call handbook: wiki/oncall (rotation starts week 3)
`;

// A plain drawing (default white paper) and a transparent image, for the
// Canvas and Image views.
const flow = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "zukai",
  elements: [
    {
      id: "c1",
      type: "ellipse",
      x: 120,
      y: 120,
      width: 220,
      height: 220,
      strokeColor: "#1e1e1e",
      backgroundColor: "#ffc9c9",
      fillStyle: "cross-hatch",
      strokeWidth: 2,
      roughness: 1,
      opacity: 100,
      seed: 7,
      version: 1,
    },
    {
      id: "r1",
      type: "rectangle",
      x: 420,
      y: 170,
      width: 220,
      height: 120,
      strokeColor: "#1971c2",
      backgroundColor: "#a5d8ff",
      fillStyle: "hachure",
      strokeWidth: 2,
      roughness: 1,
      opacity: 100,
      seed: 11,
      version: 1,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
  files: {},
});

const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 32 32"><path d="M4 7h8l4 10 4-10h8L18 27h-4z" fill="#3b74ee"/></svg>`;

const files: Record<string, string> = {
  [join(ROOT, "flow.excalidraw")]: flow,
  [join(ROOT, "logo.svg")]: logo,
  [join(ROOT, "incidents\\2026-11-12 redis failover.md")]: md,
  [join(ROOT, "incidents\\checkout-latency.csv")]: csv,
  [join(ROOT, "snippets\\k8s.sh")]: sh,
  [join(ROOT, "snippets\\slow-queries.sql")]: sql,
  [join(ROOT, "order-paid.json")]: json,
  [join(ROOT, "onboarding.txt")]: notes,
};
const dirs = new Set([
  ROOT,
  join(ROOT, "incidents"),
  join(ROOT, "snippets"),
  join(ROOT, "drafts"),
]);

const scratch: Record<string, { ext: "txt" | "excalidraw"; text: string }> = {
  s1: {
    ext: "txt",
    text: "curl -s localhost:8080/health | jq .\n\nTODO: ask Dana about the pool timeout\n",
  },
};

const KEY = "zukai-preview-session";
const fmt = { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false };
const fp = (text: string) => ({ mtimeMs: 1, size: text.length, hash: "h" });

function list(dir: string) {
  const out: { name: string; path: string; isDir: boolean; link: null }[] = [];
  const kids = new Set<string>();
  for (const p of [...dirs, ...Object.keys(files)]) {
    if (p !== dir && p.startsWith(dir + sep)) {
      const name = p.slice(dir.length + 1).split(sep)[0];
      kids.add(name);
    }
  }
  for (const name of kids) {
    const path = join(dir, name);
    out.push({ name, path, isDir: dirs.has(path), link: null });
  }
  return out;
}

/** `name` + `ext` in `dir`, numbered like Rust's when it's taken. */
function freeName(dir: string, name: string, ext: string): string {
  const taken = (p: string) => dirs.has(p) || p in files;
  let path = join(dir, name + ext);
  for (let n = 2; taken(path); n++) path = join(dir, `${name} ${n}${ext}`);
  return path;
}

type Args = Record<string, unknown>;

/*
 * Git: the Library is a repo on `main`, 2 ahead and 1 behind origin, with
 * one change of each kind. ?git=rebasing stops it mid-rebase (with a
 * conflicted file), ?git=notrepo makes it unsynced, ?git=nogit hides git.
 */
const GIT = new URLSearchParams(location.search).get("git") ?? "repo";
const UNSAVED = new URLSearchParams(location.search).has("unsaved");
const rel = (p: string) => join(ROOT, p.split("/").join(sep));

const oldMd = md
  .replace("after 31s", "after about 30s")
  .replace("- [ ] Lower `socket_timeout` in the pool to 2s\n", "")
  .replace("| 14:11 | Latency back to normal         |       |\n", "");
const roadmap = `# Q3 roadmap (draft)

- Ship the search index rewrite
- Move notes sync to git
- Drop the legacy importer
`;
const plan = `# 日本 plan "v2"

- Tokyo: 3 nights, Shinjuku
- Kyoto: 2 nights, near the station
- JR pass: 7 days
`;
const peering = `# VPC peering runbook

1. Accept the peering request in the target account.
2. Add routes for 10.40.0.0/16 on both sides.
3. Open 5432 from the app subnets only.
`;
/** In the work tree; added to the notebook's files. */
const gitFiles: Record<string, string> = {
  'notes/日本 plan "v2".md': plan,
  "projects/platform/infrastructure/terraform/modules/networking/vpc peering runbook.md":
    peering,
  "diagrams/architecture.png": "\u0000PNG",
};
for (const [p, text] of Object.entries(gitFiles)) {
  files[rel(p)] = text;
  const parts = p.split("/");
  for (let i = 1; i < parts.length; i++) {
    dirs.add(rel(parts.slice(0, i).join("/")));
  }
}
/** The last commit's text, by path; absent = not in it. */
const headTexts: Record<string, string> = {
  "incidents/2026-11-12 redis failover.md": oldMd,
  "drafts/q3-roadmap.md": roadmap,
  "misc/onboarding.txt": notes,
  'notes/日本 plan "v2".md': plan.replace("2 nights", "1 night"),
  "order-paid.json": json.replace('"retry": false', '"retry": true'),
};
const binary = new Set(["diagrams/architecture.png"]);

const repo = {
  kind: (GIT === "notrepo" ? "notRepo" : "repo") as "repo" | "notRepo",
  branch: "main",
  ahead: 2,
  behind: 1,
  state: (GIT === "rebasing" ? "rebasing" : "none") as "none" | "rebasing",
  local: [
    "main",
    "draft/reorg-2026",
    "laptop-sync",
    "spike/sqlite-fts",
    "2026-q4-planning",
    "feature/incident-retro-follow-ups-for-the-redis-failover",
  ],
  remoteOnly: [
    "laptop-draft",
    "release/0.4",
    "experiment/canvas-export",
    "dana/runbook-edits",
  ],
  changes: [
    { path: "diagrams/architecture.png", status: "modified" },
    { path: "drafts/q3-roadmap.md", status: "deleted" },
    { path: "incidents/2026-11-12 redis failover.md", status: "modified" },
    { path: 'notes/日本 plan "v2".md', status: "modified" },
    {
      path: "onboarding.txt",
      oldPath: "misc/onboarding.txt",
      status: "renamed",
    },
    ...(GIT === "rebasing"
      ? [{ path: "order-paid.json", status: "conflicted" }]
      : []),
    {
      path: "projects/platform/infrastructure/terraform/modules/networking/vpc peering runbook.md",
      status: "added",
    },
    { path: "snippets/slow-queries.sql", status: "added" },
  ] as { path: string; oldPath?: string; status: string }[],
};

function repoStatus() {
  if (GIT === "nogit") return noGit();
  if (repo.kind === "notRepo") return { kind: "notRepo" };
  return {
    kind: "repo",
    branch: repo.branch,
    head: "3f9c2a1",
    dirty: repo.changes.length > 0,
    upstream: true,
    origin: true,
    ahead: repo.ahead,
    behind: repo.behind,
    state: repo.state,
  };
}

function headFile(path: string) {
  if (binary.has(path)) return { kind: "binary" };
  const text = headTexts[path];
  return text === undefined ? { kind: "missing" } : { kind: "text", text };
}

/** A git op: takes a moment, then lands. */
const later = (land: () => void) =>
  new Promise<null>((resolve) =>
    setTimeout(() => {
      land();
      resolve(null);
    }, 700),
  );

const noGit = () =>
  Promise.reject({
    kind: "no_git",
    detail: "",
    conflicts: null,
    committed: false,
  });

const handlers: Record<string, (a: Args) => unknown> = {
  app_startup_mark: () => null,
  session_read: () => localStorage.getItem(KEY),
  session_write: (a) => localStorage.setItem(KEY, a.json as string),
  session_backup: () => null,
  scratchpad_list: () =>
    Object.entries(scratch).map(([id, s]) => ({ id, ext: s.ext })),
  scratchpad_list_closed: () => [],
  scratchpad_read: (a) => scratch[a.id as string]?.text ?? "",
  scratchpad_write: (a) => {
    scratch[a.id as string] = {
      ext: a.ext as "txt",
      text: a.content as string,
    };
  },
  // ?unsaved: the pinned script has an edit not yet saved.
  shadow_list: () => (UNSAVED ? ["f1"] : []),
  shadow_read: (a) =>
    UNSAVED && a.id === "f1" ? `${sh}\n# Drain a node first\n` : null,
  take_launch_paths: () => ({ paths: [], folders: [], missing: [] }),
  grants_filter: (a) => a.paths,
  library_root: () => ({ root: ROOT, available: true, added: [] }),
  library_list: (a) => list(a.dir as string),
  library_search: (a) => ({
    entries: Object.keys(files)
      .filter((p) => p.toLowerCase().includes(String(a.query).toLowerCase()))
      .map((p) => ({
        name: p.split(sep).pop(),
        path: p,
        isDir: false,
        link: null,
      })),
    ready: true,
  }),
  // A plain left-to-right subsequence match; Rust ranks the real one.
  library_quick_open: (a) => {
    const q = Array.from(String(a.query).replace(/\s/g, "").toLowerCase());
    const hits = Object.keys(files).flatMap((p) => {
      const rel = p
        .slice(ROOT.length + 1)
        .split(sep)
        .join("/");
      const chars = Array.from(rel.toLowerCase());
      const positions: number[] = [];
      for (let i = 0; i < chars.length && positions.length < q.length; i++) {
        if (chars[i] === q[positions.length]) positions.push(i);
      }
      if (!q.length || positions.length < q.length) return [];
      const entry = { name: p.split(sep).pop(), path: p, isDir: false };
      return [{ entry: { ...entry, link: null }, rel, positions, score: 0 }];
    });
    return { hits, ready: true };
  },
  library_resolve: (a) => a.path,
  library_create_folder: (a) => {
    const path = freeName(a.parent as string, a.name as string, "");
    dirs.add(path);
    return path;
  },
  library_create_file: (a) => {
    const ext = a.ext ? `.${a.ext as string}` : "";
    const path = freeName(a.parent as string, a.stem as string, ext);
    files[path] = "";
    return path;
  },
  library_rename: (a) => {
    const from = a.path as string;
    const dir = from.split(sep).slice(0, -1).join(sep);
    const name = from.split(sep).pop() ?? "";
    const dot = dirs.has(from) ? -1 : name.lastIndexOf(".");
    const to = join(
      dir,
      (a.newName as string) + (dot > 0 ? name.slice(dot) : ""),
    );
    if (to === from) return from;
    if (dirs.has(from)) {
      dirs.delete(from);
      dirs.add(to);
    } else {
      files[to] = files[from] ?? "";
      delete files[from];
    }
    // Like Rust's watcher: the folder's change event can beat the reply.
    void emit("zukai://library-changed", { dirs: [dir] });
    return to;
  },
  library_follow: (a) =>
    (a.paths as string[]).map((p) =>
      p === a.from || p.startsWith((a.from as string) + sep)
        ? (a.to as string) + p.slice((a.from as string).length)
        : null,
    ),
  file_read: (a) => {
    const path = a.path as string;
    const text = files[path];
    // Like Rust: a gone file is an io error and has no fingerprint.
    if (text === undefined) {
      return Promise.reject({ kind: "io", message: "The file is gone." });
    }
    const readable = !text.includes("\u0000");
    return { text, format: fmt, readable, fingerprint: fp(text) };
  },
  file_write: (a) => {
    files[a.path as string] = a.text as string;
    return { kind: "written", fingerprint: fp(a.text as string) };
  },
  file_read_bytes: (a) =>
    new TextEncoder().encode(files[a.path as string] ?? "").buffer,
  file_fingerprint: (a) =>
    (a.path as string) in files ? fp(files[a.path as string]) : null,
  file_fingerprint_quick: (a) => a.expected,
  // Ask: a configured Anthropic key, and a canned answer streamed in words.
  ai_status: () => AI_STATUS,
  ai_config_set: () => AI_STATUS,
  ai_key_set: () => AI_STATUS,
  ai_key_remove: () => AI_STATUS,
  ai_models: () => ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  // Git sync: the Library is a repo with work in it (see `repo` below).
  git_set_enabled: () => ({ available: GIT !== "none" }),
  git_status: () => repoStatus(),
  git_pull: () =>
    later(() => {
      repo.behind = 0;
    }),
  git_commit_push: () =>
    later(() => {
      repo.changes = [];
      repo.ahead = 0;
    }),
  git_push: () =>
    later(() => {
      repo.ahead = 0;
    }),
  git_setup: () => later(() => (repo.kind = "repo")),
  git_pick_clone_parent: () => null,
  git_clone: noGit,
  git_cancel: () => null,
  git_changes: () => (repo.kind === "repo" ? repo.changes : []),
  git_branches: () => ({
    current: repo.branch,
    local: [
      { name: repo.branch, upstream: `origin/${repo.branch}` },
      ...repo.local
        .filter((n) => n !== repo.branch)
        .sort()
        .map((name) => ({ name, upstream: null })),
    ],
    remoteOnly: repo.remoteOnly.filter((n) => !repo.local.includes(n)).sort(),
  }),
  git_switch: (a) =>
    later(() => {
      const name = a.branch as string;
      if (!repo.local.includes(name)) repo.local.push(name);
      repo.branch = name;
    }),
  git_create_branch: (a) =>
    later(() => {
      repo.local.push(a.name as string);
      repo.branch = a.name as string;
    }),
  git_head_file: (a) => headFile(a.path as string),
  ai_cancel: (a) => {
    cancelled.add(a.id as number);
    return null;
  },
  ai_ask: (a) => {
    const channel = a.onEvent as { onmessage(e: unknown): void };
    const id = a.id as number;
    const words = ANSWER.split(/(?<= )/);
    let i = 0;
    const tick = () => {
      if (cancelled.has(id)) return;
      if (i >= words.length) return channel.onmessage({ kind: "done" });
      channel.onmessage({ kind: "text", text: words[i++] });
      setTimeout(tick, 18);
    };
    setTimeout(tick, 700);
    return null;
  },
};

const AI_STATUS = {
  config: { provider: "anthropic", model: "" },
  hasKey: true,
  ready: true,
};
const cancelled = new Set<number>();
const ANSWER = `The note is an incident write-up: the Redis primary in **eu-west-1b** failed, Sentinel promoted the replica in 31s, but the checkout workers kept a pooled connection to the old primary.

**The real bug** is that the pool resolved the master once, at startup, and never again. Restarting the workers fixed it only because they re-resolved on boot.

Still open:

- Lower \`socket_timeout\` to 2s so stale connections fail fast.
- Add a failover drill to the runbook.

\`\`\`python
pool = redis.ConnectionPool(host=sentinel.discover_master("cache")[0])
\`\`\``;

mockWindows("main");
mockIPC(
  (cmd, payload) => {
    const h = handlers[cmd];
    if (h) return h((payload ?? {}) as Args);
    if (cmd.startsWith("plugin:")) return null;
    return null;
  },
  { shouldMockEvents: true },
);

/**
 * ?demo opens a ready-made workspace (sidebar open, a note, a script and a
 * Scratchpad), for screenshots. ?mode=light|dark, ?light=, ?dark= and
 * ?accent= pick the theme. ?reset starts empty.
 */
function demoSession(params: URLSearchParams): string {
  const fileTab = (
    id: string,
    rel: string,
    language: string,
    unsaved = false,
  ) => {
    const path = join(ROOT, rel);
    return {
      id,
      kind: "text",
      title: rel.split(sep).pop(),
      renamed: false,
      language,
      languagePicked: false,
      languageGuessed: false,
      selection: { anchor: 0, head: 0 },
      scrollTop: 0,
      wrap: false,
      file: {
        path,
        format: fmt,
        fingerprint: fp(files[path] ?? ""),
        held: null,
        ...(unsaved ? { unsaved: true } : {}),
      },
      ...(language === "markdown" ? { markdownMode: "rich" } : {}),
    };
  };
  const s1 = {
    ...fileTab("s1", "x", "plaintext"),
    title: "curl -s localhost:8080/health …",
  };
  delete (s1 as { file?: unknown }).file;
  return JSON.stringify({
    version: 3,
    tabs: [
      { ...fileTab("f1", "snippets\\k8s.sh", "shell", UNSAVED), pinned: true },
      s1,
      fileTab("f2", "incidents\\2026-11-12 redis failover.md", "markdown"),
      { ...fileTab("f3", "flow.excalidraw", "plaintext"), kind: "canvas" },
      { ...fileTab("f4", "logo.svg", "plaintext"), kind: "image" },
    ],
    activeId: params.get("tab") ?? "f2",
    closed: [],
    splits: [],
    sidebar: {
      open: true,
      width: Number(params.get("width") ?? 260),
      expanded: [join(ROOT, "incidents"), join(ROOT, "snippets")],
      view: params.get("view") === "git" ? "git" : "files",
    },
    fontSize: 14,
    settings: {
      theme: params.get("mode") ?? "dark",
      lightTheme: params.get("light") ?? "paper",
      darkTheme: params.get("dark") ?? "graphite",
      accent: params.get("accent") ?? "blue",
      wrapNewTabs: false,
      lineNumbers: true,
      previewSplit: 0.5,
      markdownDefault: "rich",
    },
  });
}

const params = new URLSearchParams(location.search);
if (params.has("reset")) localStorage.removeItem(KEY);
if (params.has("demo")) localStorage.setItem(KEY, demoSession(params));

// The rich editor is lazy in the app; loading it first lets a screenshot
// of ?demo show the note without waiting.
if (params.has("demo")) await import("../rich/RichEditor");
await import("../main");

// ?ask opens the Ask panel once the app is up (Mod+J), for screenshots.
if (params.has("ask")) {
  setTimeout(() => {
    const mac = navigator.userAgent.includes("Mac");
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        code: "KeyJ",
        ctrlKey: !mac,
        metaKey: mac,
        bubbles: true,
      }),
    );
  }, 1500);
}

/**
 * With ?view=git: ?diff=<path> opens that change's diff tab; ?branches opens
 * the branch menu, and ?branches=<name> then picks that branch.
 */
/** Clicks the first element `find` returns, once there is one. */
function clickWhen(
  find: () => HTMLElement | null | undefined,
  then?: () => void,
) {
  const t = window.setInterval(() => {
    const el = find();
    if (!el) return;
    window.clearInterval(t);
    el.click();
    then?.();
  }, 50);
}
const diff = params.get("diff");
if (diff) {
  clickWhen(() =>
    document.querySelector<HTMLElement>(`li[data-path="${CSS.escape(diff)}"]`),
  );
}
if (params.has("branches")) {
  const pick = params.get("branches");
  clickWhen(
    () => document.querySelector<HTMLElement>("[data-z-git-branch]"),
    () =>
      pick &&
      clickWhen(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[aria-label="Branches"] [role="menuitemradio"]',
          ),
        ].find((r) => r.textContent?.endsWith(pick)),
      ),
  );
}

// ?settings opens Settings once the app is up (Mod+,), for screenshots.
if (params.has("settings")) {
  setTimeout(() => {
    const mac = navigator.userAgent.includes("Mac");
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ",",
        code: "Comma",
        ctrlKey: !mac,
        metaKey: mac,
        bubbles: true,
      }),
    );
  }, 1500);
}
