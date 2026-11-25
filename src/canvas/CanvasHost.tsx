import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { detectPlatform, matchShortcut, type Command } from "../app/shortcuts";
import type { TabState, Viewport } from "../model/types";
import { Bar } from "../ui/FileBar";
import { parseScene, sceneSignature, type Scene } from "./scene";

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");
type Elements = readonly OrderedExcalidrawElement[];

export interface CanvasHostProps {
  tabs: TabState[];
  activeId: string;
  loadContent(id: string): Promise<string>;
  /** A drawing change, as `.excalidraw` JSON (never a viewport change). */
  onChange(id: string, text: string): void;
  onTabPatch(id: string, patch: Partial<TabState>): void;
  /** Reload / Load disk version: each `seq` is applied once. */
  replaceRequests?: readonly { seq: number; id: string; text: string }[];
  /** Closing, a read-only File or an unreadable shadow: view only. */
  isReadOnly(id: string): boolean;
  theme: "light" | "dark";
  /** An app shortcut pressed inside the canvas (the app's, not Excalidraw's). */
  onShortcut(cmd: Command): void;
}

export const INVALID_CANVAS =
  "This file isn't a valid Excalidraw drawing, so it's open read-only to protect it.";

/** Where Excalidraw fetches its fonts from: bundled with the app (vite.config.ts). */
export const EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
/** The viewport is reported back this long after it settles. */
const VIEWPORT_DELAY = 300;

const platform = detectPlatform();

let loading: Promise<ExcalidrawModule> | null = null;

/** Excalidraw and its styles, loaded on the first Canvas Tab only. */
function loadExcalidraw(): Promise<ExcalidrawModule> {
  if (!loading) {
    window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
    const p = Promise.all([
      import("@excalidraw/excalidraw"),
      import("@excalidraw/excalidraw/index.css"),
      import("./canvas.css"),
    ]).then(([m]) => m);
    // A failed load can be tried again by the next Canvas Tab.
    p.catch(() => {
      if (loading === p) loading = null;
    });
    loading = p;
  }
  return loading;
}

/**
 * Commands for the text editor (or a PDF): on a canvas they're Excalidraw's
 * keys (its own search, its own zoom, and Mod+G groups shapes).
 */
const TEXT_ONLY: ReadonlySet<Command["type"]> = new Set([
  "find",
  "replace",
  "toggleWrap",
  "format",
  "zoom",
  "goToPage",
]);

/**
 * A drawing on Excalidraw's default white paper shows on Zukai's own editor
 * ground instead: the canvas is transparent while shown, so it matches the
 * theme (and its tab), and is written back as white, so the file never
 * changes for it. A drawing with a background of its own keeps it.
 */
const DEFAULT_PAPER = "#ffffff";

function shownBackground<T extends { viewBackgroundColor?: unknown }>(
  appState: T,
): T {
  const bg = appState.viewBackgroundColor;
  const plain =
    bg === undefined ||
    (typeof bg === "string" &&
      ["#ffffff", "#fff", "white"].includes(bg.toLowerCase()));
  return plain ? { ...appState, viewBackgroundColor: "transparent" } : appState;
}

function savedBackground<T extends { viewBackgroundColor?: unknown }>(
  appState: T,
): T {
  return appState.viewBackgroundColor === "transparent"
    ? { ...appState, viewBackgroundColor: DEFAULT_PAPER }
    : appState;
}

/**
 * The appState a `.excalidraw` file keeps (background, grid…), by
 * Excalidraw's own export filter rather than a list of our own.
 */
function savedAppState(
  mod: ExcalidrawModule,
  appState: Partial<AppState>,
): Record<string, unknown> {
  const out: unknown = JSON.parse(
    mod.serializeAsJSON([], appState, {}, "local"),
  ).appState;
  return typeof out === "object" && out !== null
    ? (out as Record<string, unknown>)
    : {};
}

const newestReplace = (p: CanvasHostProps, id: string) =>
  (p.replaceRequests ?? []).reduce(
    (n, r) => (r.id === id && r.seq > n ? r.seq : n),
    0,
  );

/**
 * The active Canvas Tab in an embedded Excalidraw. Nothing (not even the
 * Excalidraw chunk) loads until a Canvas Tab is shown.
 */
export function CanvasHost(props: CanvasHostProps) {
  const active = props.tabs.find((t) => t.id === props.activeId);
  const isCanvas = active?.kind === "canvas";
  const [mod, setMod] = useState<ExcalidrawModule | null>(null);
  /** The Tab that couldn't load Excalidraw; another Canvas Tab tries again. */
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const canvasId = isCanvas ? props.activeId : null;
  useEffect(() => {
    if (canvasId === null || mod) return;
    let live = true;
    loadExcalidraw().then(
      (m) => live && setMod(m),
      (err: unknown) => {
        console.error("load excalidraw", err);
        if (live) setFailedFor(canvasId);
      },
    );
    return () => {
      live = false;
    };
  }, [canvasId, mod]);

  // App shortcuts win over Excalidraw's: caught on the way down, before
  // Excalidraw's own listeners see them.
  useEffect(() => {
    if (!isCanvas) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.target instanceof Node) || !box.current?.contains(e.target)) {
        return;
      }
      const cmd = matchShortcut(e, platform);
      if (!cmd || TEXT_ONLY.has(cmd.type)) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.onShortcut(cmd);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isCanvas]);

  if (!active || !isCanvas) return null;
  return (
    <div ref={box} className="z-canvas relative size-full">
      {!mod && failedFor === active.id ? (
        <Message>Can't load the canvas editor.</Message>
      ) : (
        <CanvasTab
          key={active.id}
          id={active.id}
          mod={mod}
          p={props}
          host={latest}
        />
      )}
    </div>
  );
}

function Message({ children }: { children: string }) {
  return (
    <div className="grid size-full select-none place-items-center text-ui-sm text-faint">
      {children}
    </div>
  );
}

/** What a Tab shows: loading, a drawing (generation `gen`), or why not. */
type Doc =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "invalid" }
  | { kind: "scene"; scene: Scene; gen: number };

const docOf = (text: string, gen: number): Doc => {
  const r = parseScene(text);
  return r.ok ? { kind: "scene", scene: r.scene, gen } : { kind: "invalid" };
};

const asElements = (s: Scene) =>
  s.elements as unknown as NonNullable<ExcalidrawInitialDataState["elements"]>;

function viewportOf(a: Partial<AppState>): Viewport | null {
  const zoom = a.zoom?.value;
  if (
    typeof a.scrollX !== "number" ||
    typeof a.scrollY !== "number" ||
    typeof zoom !== "number"
  ) {
    return null;
  }
  return { scrollX: a.scrollX, scrollY: a.scrollY, zoom };
}

const sameViewport = (a: Viewport | null, b: Viewport) =>
  a !== null &&
  a.scrollX === b.scrollX &&
  a.scrollY === b.scrollY &&
  a.zoom === b.zoom;

/**
 * One Canvas Tab, mounted while it is the active Tab. `p` is this render's
 * props; callbacks read the latest through `host`.
 */
function CanvasTab({
  id,
  mod,
  p,
  host,
}: {
  id: string;
  mod: ExcalidrawModule | null;
  p: CanvasHostProps;
  host: RefObject<CanvasHostProps>;
}) {
  const [doc, setDoc] = useState<Doc>({ kind: "loading" });
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  /** The signature of the drawing as last loaded or saved. */
  const baseline = useRef("");
  /** The newest replace `seq` applied (or already in the loaded text). */
  const applied = useRef(0);
  const gen = useRef(0);
  const tab = p.tabs.find((t) => t.id === id);
  const [startView] = useState(() => tab?.viewport ?? null);
  const view = useRef<Viewport | null>(startView);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const readOnly = p.isReadOnly(id);

  useEffect(() => {
    let live = true;
    // The loaded text has every replace issued so far.
    const known = newestReplace(host.current, id);
    host.current.loadContent(id).then(
      (text) => {
        if (!live) return;
        applied.current = Math.max(applied.current, known);
        setDoc(docOf(text, ++gen.current));
      },
      (err: unknown) => {
        console.error("load canvas", err);
        if (live) setDoc({ kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [host, id]);

  /** Excalidraw's start: its elements normalised as it will, and the view. */
  const start = useMemo(() => {
    if (!mod || doc.kind !== "scene") return null;
    const elements = mod.restoreElements(asElements(doc.scene), null, {
      repairBindings: true,
    });
    const appState: ExcalidrawInitialDataState["appState"] = {
      ...shownBackground(doc.scene.appState),
      ...(startView && {
        scrollX: startView.scrollX,
        scrollY: startView.scrollY,
        zoom: { value: startView.zoom as AppState["zoom"]["value"] },
      }),
    };
    const initialData: ExcalidrawInitialDataState = {
      elements,
      appState,
      files: doc.scene.files as BinaryFiles,
      scrollToContent: !startView,
    };
    return {
      initialData,
      signature: sceneSignature(
        elements,
        doc.scene.files,
        // As Excalidraw will hold it: the file's, with defaults filled in.
        savedAppState(mod, mod.restoreAppState(doc.scene.appState, null)),
      ),
    };
  }, [mod, doc, startView]);

  useLayoutEffect(() => {
    if (start) baseline.current = start.signature;
  }, [start]);

  // Reload / Load disk version: the new scene replaces the drawing as one
  // step, and undo can't go back past it. A layout effect, so no stroke
  // lands on the scene about to be replaced.
  useLayoutEffect(() => {
    if (doc.kind === "loading" || doc.kind === "failed") return;
    for (const r of p.replaceRequests ?? []) {
      if (r.id !== id || r.seq <= applied.current) continue;
      applied.current = r.seq;
      const next = docOf(r.text, ++gen.current);
      const a = api.current;
      if (next.kind === "scene" && doc.kind === "scene" && a && mod) {
        const elements = mod.restoreElements(asElements(next.scene), null, {
          repairBindings: true,
        });
        const files = Object.values(next.scene.files) as BinaryFileData[];
        if (files.length > 0) a.addFiles(files);
        const appState = mod.restoreAppState(
          next.scene.appState,
          a.getAppState(),
        );
        a.updateScene({
          elements,
          appState: shownBackground(appState),
          captureUpdate: mod.CaptureUpdateAction.NEVER,
        });
        a.history.clear();
        baseline.current = sceneSignature(
          elements,
          next.scene.files,
          savedAppState(mod, appState),
        );
      } else {
        // Not showing a drawing yet (or any more): start over from the text.
        api.current = null;
        setDoc(next);
      }
    }
  }, [p.replaceRequests, doc, mod, id]);

  // The viewport goes to the Tab (the Session), debounced; flushed on leave.
  useEffect(
    () => () => {
      if (viewTimer.current === undefined) return;
      clearTimeout(viewTimer.current);
      if (view.current) host.current.onTabPatch(id, { viewport: view.current });
    },
    [host, id],
  );

  const onSceneChange = (
    elements: Elements,
    appState: AppState,
    files: BinaryFiles,
  ) => {
    const v = viewportOf(appState);
    if (v && !sameViewport(view.current, v)) {
      view.current = v;
      clearTimeout(viewTimer.current);
      viewTimer.current = setTimeout(() => {
        viewTimer.current = undefined;
        host.current.onTabPatch(id, { viewport: v });
      }, VIEWPORT_DELAY);
    }
    if (!mod || host.current.isReadOnly(id)) return;
    const saved = savedBackground(appState);
    const signature = sceneSignature(
      elements,
      files,
      savedAppState(mod, saved),
    );
    if (signature === baseline.current) return;
    baseline.current = signature;
    host.current.onChange(
      id,
      mod.serializeAsJSON(elements, saved, files, "local"),
    );
  };

  if (doc.kind === "failed") return <Message>Can't load this canvas.</Message>;
  if (doc.kind === "invalid") {
    return <Bar kind="info">{INVALID_CANVAS}</Bar>;
  }
  if (!mod || !start || doc.kind !== "scene") {
    return <Message>Loading canvas…</Message>;
  }
  const { Excalidraw, MainMenu } = mod;
  return (
    <Excalidraw
      key={doc.gen}
      initialData={start.initialData}
      excalidrawAPI={(a) => {
        api.current = a;
      }}
      onChange={onSceneChange}
      theme={p.theme}
      viewModeEnabled={readOnly}
      // Its own keys only while it has focus (the other half may be text).
      handleKeyboardGlobally={false}
      // No network: no collaboration, AI, embeds or online library.
      isCollaborating={false}
      aiEnabled={false}
      validateEmbeddable={() => false}
      UIOptions={{
        canvasActions: {
          // Files are the app's: no opening or saving them from Excalidraw.
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: null,
        },
      }}
    >
      {/* Its default menu, minus the theme toggle and the social links. */}
      <MainMenu>
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}
