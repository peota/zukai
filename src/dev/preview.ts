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

const csv = `endpoint,service,owner,p50_ms,p95_ms,p99_ms,requests,errors,error_rate
/checkout,checkout-svc,payments,182,640,4100,18234,41,0.22%
/checkout/confirm,checkout-svc,payments,210,720,3900,15120,38,0.25%
/cart,cart-svc,web,64,210,380,52011,3,0.01%
/cart/items,cart-svc,web,58,190,350,61204,5,0.01%
/search,search-api,discovery,95,310,720,88120,12,0.01%
/search/suggest,search-api,discovery,22,70,140,203118,0,0.00%
/product/:id,catalog,discovery,41,120,260,140932,0,0.00%
/product/:id/reviews,catalog,discovery,88,260,610,30411,2,0.01%
/login,auth,identity,120,300,510,9120,7,0.08%
/logout,auth,identity,15,40,90,4210,0,0.00%
/account,account-svc,identity,76,230,480,11870,1,0.01%
/orders,orders-svc,payments,134,420,980,8840,9,0.10%
/orders/:id,orders-svc,payments,61,180,390,14502,2,0.01%
/payments/intent,payments-gw,payments,240,810,2600,7710,22,0.29%
/shipping/quote,shipping,fulfilment,152,470,1100,6540,4,0.06%
/inventory/:sku,inventory,fulfilment,33,95,210,48120,0,0.00%
/recommendations,recs,discovery,170,520,1300,39880,15,0.04%
/wishlist,account-svc,web,47,140,300,5320,0,0.00%
/coupons/apply,promo,growth,90,280,640,3190,6,0.19%
/health,gateway,platform,2,4,9,86400,0,0.00%
`;

const notes = `Onboarding notes

- VPN: use the "eng" profile, not "corp"
- Staging DB is read-only for us; ask #data for writes
- Feature flags live in flags.yaml, deployed with the service
- On-call handbook: wiki/oncall (rotation starts week 3)
`;

// A drawing (default white paper) and a transparent image, for the Canvas and
// Image views. The drawing is the checkout path from the Redis failover note.
let seed = 1;
const ink = "#1e1e1e";
const base = (id: string, stroke = ink) => ({
  id,
  strokeColor: stroke,
  strokeWidth: 2,
  roughness: 1,
  opacity: 100,
  seed: seed++,
  version: 1,
});
/** Text centred on (cx, y); Excalidraw aligns it inside the box we guess. */
const label = (
  id: string,
  text: string,
  cx: number,
  y: number,
  size = 20,
  stroke = ink,
  align: "center" | "left" = "center",
) => {
  const lines = text.split("\n");
  const width = Math.max(...lines.map((l) => l.length)) * size * 0.55;
  return {
    ...base(id, stroke),
    type: "text",
    x: align === "center" ? cx - width / 2 : cx,
    y,
    width,
    height: lines.length * size * 1.25,
    text,
    originalText: text,
    fontSize: size,
    fontFamily: 5,
    textAlign: align,
    verticalAlign: "top",
    lineHeight: 1.25,
    containerId: null,
    autoResize: true,
  };
};
/** A filled box with a title and an optional second line. */
const box = (
  id: string,
  x: number,
  y: number,
  fill: string,
  title: string,
  sub = "",
  shape: "rectangle" | "ellipse" = "rectangle",
  w = 190,
  h = 84,
) => [
  {
    ...base(id),
    type: shape,
    x,
    y,
    width: w,
    height: h,
    backgroundColor: fill,
    fillStyle: "solid",
    roundness: shape === "rectangle" ? { type: 3 } : null,
  },
  label(id + "t", title, x + w / 2, y + (sub ? 16 : 28), 22),
  ...(sub ? [label(id + "s", sub, x + w / 2, y + 48, 16, "#495057")] : []),
];
const arrow = (
  id: string,
  x: number,
  y: number,
  dx: number,
  dy: number,
  stroke = ink,
  dashed = false,
  both = false,
) => ({
  ...base(id, stroke),
  type: "arrow",
  x,
  y,
  width: Math.abs(dx),
  height: Math.abs(dy),
  points: [
    [0, 0],
    [dx, dy],
  ],
  strokeStyle: dashed ? "dashed" : "solid",
  startArrowhead: both ? "arrow" : null,
  endArrowhead: "arrow",
  roundness: { type: 2 },
});
const red = "#e03131";
const green = "#2f9e44";
const flow = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "zukai",
  elements: [
    label("title", "Checkout: cache path", 40, -40, 32, ink, "left"),
    label("date", "incident 12 Nov, 14:02", 40, 4, 18, "#868e96", "left"),
    ...box("web", 40, 200, "#e9ecef", "Browser", "web + mobile"),
    ...box("gw", 300, 200, "#d0bfff", "API gateway", "rate limit, auth"),
    ...box("svc", 560, 200, "#a5d8ff", "checkout-svc", "redis pool x 32"),
    ...box("rp", 900, 60, "#ffc9c9", "Redis primary", "eu-west-1b"),
    ...box("rr", 900, 340, "#b2f2bb", "Redis replica", "eu-west-1c"),
    ...box("pg", 560, 470, "#ffec99", "Postgres", "orders"),
    ...box(
      "sen",
      1200,
      200,
      "#fff3bf",
      "Sentinel",
      "quorum 2 of 3",
      "ellipse",
      200,
      90,
    ),
    arrow("a1", 230, 242, 70, 0),
    arrow("a2", 490, 242, 70, 0),
    arrow("a3", 750, 222, 150, -100, red),
    label("a3t", "stale pooled conn", 780, 130, 16, red),
    arrow("a4", 750, 262, 150, 100, green, true),
    label("a4t", "should re-resolve", 790, 340, 16, green),
    arrow("a5", 655, 284, 0, 186),
    label("a5t", "orders", 668, 360, 16, "#495057", "left"),
    arrow("a6", 995, 144, 0, 196, "#495057", true),
    label("a6t", "replication", 1008, 228, 16, "#495057", "left"),
    arrow("a7", 1210, 225, -120, -110, "#495057", true),
    arrow("a8", 1210, 265, -120, 110, "#495057", true),
    label("a7t", "promoted\nafter 31s", 1240, 330, 16, green, "left"),
    label("down", "X down", 1100, 30, 22, red, "left"),
    {
      ...base("note", "#f08c00"),
      type: "rectangle",
      x: 900,
      y: 480,
      width: 330,
      height: 96,
      backgroundColor: "#fff9db",
      fillStyle: "solid",
      strokeStyle: "dashed",
      roundness: { type: 3 },
    },
    label(
      "notet",
      "Fix: re-resolve the master on\nfailover, socket_timeout=2s",
      916,
      498,
      18,
      "#e8590c",
      "left",
    ),
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
  files: {},
});

const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 32 32"><path d="M4 7h8l4 10 4-10h8L18 27h-4z" fill="#3b74ee"/></svg>`;

// A two-page runbook PDF, for the PDF view. ASCII only: file_read_bytes
// encodes the string as UTF-8.
const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c);
/** Text at (x, y) in a font (F1 Helvetica, F2 bold, F3 Courier) and grey. */
const txt = (x: number, y: number, size: number, t: string, f = 1, g = 0.13) =>
  `${g} g BT /F${f} ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET`;
const rect = (x: number, y: number, w: number, h: number, rgb: string) =>
  `${rgb} rg ${x} ${y} ${w} ${h} re f`;
/** A paragraph of lines, 15pt apart, from y down. */
const para = (x: number, y: number, lines: string[], f = 1, size = 11) =>
  lines.map((l, i) => txt(x, y - i * 15, size, l, f, 0.2));
const code = (y: number, lines: string[]) => [
  rect(
    72,
    y - lines.length * 14 - 4,
    468,
    lines.length * 14 + 16,
    "0.95 0.95 0.96",
  ),
  ...lines.map((l, i) => txt(84, y - i * 14, 9.5, l, 3, 0.15)),
];
const footer = (n: number) => [
  rect(72, 60, 468, 0.6, "0.8 0.8 0.82"),
  txt(72, 44, 9, "Platform team  /  Runbooks  /  Redis", 1, 0.5),
  txt(520, 44, 9, `${n} / 2`, 1, 0.5),
];
const runbookPages = [
  [
    rect(0, 742, 612, 50, "0.23 0.45 0.93"),
    txt(72, 760, 13, "RUNBOOK  RB-014", 2, 1),
    txt(72, 690, 26, "Redis failover", 2),
    txt(
      72,
      668,
      11,
      "Owner: platform on-call    Last reviewed: 14 Nov 2026    Severity: SEV-2",
      1,
      0.45,
    ),
    txt(72, 630, 15, "1. Symptoms", 2),
    ...para(84, 608, [
      "-  p99 latency on /checkout above 2s for more than 3 minutes",
      "-  Sentinel logs +switch-master for the cache master group",
      "-  Errors: READONLY You can't write against a read only replica",
    ]),
    txt(72, 548, 15, "2. Confirm the promotion", 2),
    ...para(72, 526, ["Ask any Sentinel which node is the master now:"]),
    ...code(502, [
      "$ redis-cli -p 26379 sentinel get-master-addr-by-name cache",
      '1) "10.40.3.17"',
      '2) "6379"',
    ]),
    txt(72, 432, 15, "3. Recover the app", 2),
    ...para(84, 410, [
      "1.  Restart the checkout workers so each pool re-resolves the master.",
      "2.  Watch p99 on the checkout dashboard; it settles within 2 minutes.",
      "3.  If it does not, drain the old primary from the pool by hand:",
    ]),
    ...code(356, ["$ kubectl rollout restart deploy/checkout -n shop"]),
    txt(72, 310, 15, "Why it happens", 2),
    ...para(72, 288, [
      "The client pool resolves the master once at start-up. After a failover it",
      "keeps writing to the old primary, now a replica, until the socket times out.",
      "The fix is tracked in PLAT-2291: discover the master through Sentinel",
      "and set socket_timeout to 2s.",
    ]),
    ...footer(1),
  ],
  [
    txt(72, 720, 15, "4. Verify", 2),
    rect(72, 676, 468, 22, "0.93 0.95 1"),
    txt(80, 683, 10, "Check", 2),
    txt(300, 683, 10, "Expected", 2),
    ...[
      ["p99 /checkout", "under 700 ms"],
      ["Error rate", "under 0.05%"],
      ["Sentinel quorum", "3 of 3 agree"],
      ["Replication lag", "under 1 s"],
    ].flatMap(([a, b], i) => [
      txt(80, 660 - i * 22, 10, a, 1, 0.2),
      txt(300, 660 - i * 22, 10, b, 1, 0.2),
      rect(72, 652 - i * 22, 468, 0.5, "0.85 0.85 0.88"),
    ]),
    txt(72, 540, 15, "5. Follow-ups", 2),
    ...para(84, 518, [
      "[ ]  Lower socket_timeout in the pool to 2s",
      "[ ]  Add a failover drill to the quarterly game day",
      "[x]  Alert on +switch-master in #platform-alerts",
    ]),
    txt(72, 458, 15, "Contacts", 2),
    ...para(84, 436, [
      "Platform on-call    pager: platform-primary",
      "Payments team       #payments-oncall",
    ]),
    ...footer(2),
  ],
].map((ops) => ops.join("\n"));
const pdf = (() => {
  const n = runbookPages.length;
  const font = (base: string) =>
    `<</Type/Font/Subtype/Type1/BaseFont/${base}>>`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${runbookPages.map((_, i) => `${6 + i * 2} 0 R`).join(" ")}]/Count ${n}>>`,
    font("Helvetica"),
    font("Helvetica-Bold"),
    font("Courier"),
    ...runbookPages.flatMap((s, i) => [
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${7 + i * 2} 0 R/Resources<</Font<</F1 3 0 R/F2 4 0 R/F3 5 0 R>>>>>>`,
      `<</Length ${s.length}>>stream\n${s}\nendstream`,
    ]),
  ];
  // Byte offsets for the xref table: ASCII, so a character is a byte.
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  const pad = (at: number) => String(at).padStart(10, "0");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((at) => `${pad(at)} 00000 n \n`).join("");
  out += `trailer\n<</Root 1 0 R/Size ${objs.length + 1}>>\n`;
  return out + `startxref\n${xref}\n%%EOF\n`;
})();

const files: Record<string, string> = {
  [join(ROOT, "flow.excalidraw")]: flow,
  [join(ROOT, "logo.svg")]: logo,
  [join(ROOT, "runbook.pdf")]: pdf,
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
  pdf_positions_read: () => localStorage.getItem(KEY + ".pdf"),
  pdf_positions_write: (a) =>
    localStorage.setItem(KEY + ".pdf", a.json as string),
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
  // The New terminal menu: three agents installed, two not.
  terminal_agents: () => [
    { id: "claude-code", name: "Claude Code", installed: true },
    { id: "codex", name: "Codex", installed: false },
    { id: "gemini", name: "Gemini", installed: true },
    { id: "opencode", name: "OpenCode", installed: true },
    { id: "cursor", name: "Cursor", installed: false },
  ],
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
  // Git sync: the Library is a repo with work in it (see `repo` below).
  git_set_enabled: () => ({ available: GIT !== "nogit" }),
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
};

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
      {
        ...fileTab("f3", "flow.excalidraw", "plaintext"),
        kind: "canvas",
        // Fits the whole diagram in the 1280x800 demo window.
        viewport: { scrollX: 30, scrollY: 318, zoom: 0.68 },
      },
      { ...fileTab("f4", "logo.svg", "plaintext"), kind: "image" },
      { ...fileTab("f5", "runbook.pdf", "plaintext"), kind: "pdf" },
    ],
    activeId: params.get("tab") ?? "f2",
    closed: [],
    splits: [],
    sidebar: {
      open: true,
      width: Number(params.get("width") ?? 260),
      expanded: [join(ROOT, "incidents"), join(ROOT, "snippets")],
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

// ?view=git opens the Git panel once the app is up (Mod+Shift+G).
if (params.get("view") === "git") {
  setTimeout(() => {
    const mac = navigator.userAgent.includes("Mac");
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "G",
        code: "KeyG",
        ctrlKey: !mac,
        metaKey: mac,
        shiftKey: true,
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
