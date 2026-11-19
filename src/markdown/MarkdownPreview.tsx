import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

/** Text changes per Tab id, for a preview that follows typing. */
export interface TextFeed {
  subscribe(id: string, onText: (text: string) => void): () => void;
}

/** A TextFeed the editor's onChange publishes into. */
export function createTextFeed(): TextFeed & {
  publish(id: string, text: string): void;
} {
  const subs = new Map<string, Set<(text: string) => void>>();
  return {
    subscribe(id, onText) {
      const set = subs.get(id) ?? new Set();
      set.add(onText);
      subs.set(id, set);
      return () => {
        set.delete(onText);
        if (set.size === 0) subs.delete(id);
      };
    },
    publish(id, text) {
      subs.get(id)?.forEach((f) => f(text));
    },
  };
}

/** Typing re-renders the preview at most this often. */
export const PREVIEW_DEBOUNCE_MS = 120;

export interface MarkdownPreviewProps {
  id: string;
  loadContent(id: string): Promise<string>;
  feed: TextFeed;
  /** A web or mail link was clicked: open it outside the app. */
  onOpenLink(url: string): void;
}

type Render = typeof import("./render");

/** Tab `id`'s text, rendered as Markdown, following edits as they're made. */
export function MarkdownPreview({
  id,
  loadContent,
  feed,
  onOpenLink,
}: MarkdownPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const box = useRef<HTMLElement>(null);
  const lib = useRef<Render | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string | null = null;
    // The renderer (and its Markdown and sanitizer libraries) loads with the
    // first preview, not with the app.
    const ready = import("./render").then((m) => (lib.current = m));
    const show = (text: string) =>
      void ready.then((m) => live && setHtml(m.renderMarkdown(text)));
    void loadContent(id).then((text) => {
      // An edit that arrived meanwhile is newer.
      if (live && pending === null) show(text);
    });
    const off = feed.subscribe(id, (text) => {
      pending = text;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (pending !== null) show(pending);
      }, PREVIEW_DEBOUNCE_MS);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [id, loadContent, feed]);

  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest?.("a");
    if (!a || !box.current?.contains(a)) return;
    // Never navigate the app's own page.
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    const kind = lib.current?.linkKind(href) ?? null;
    if (kind === "web") {
      onOpenLink(href.trim());
    } else if (kind === "anchor") {
      const target = decodeURIComponent(href.trim().slice(1));
      box.current
        ?.querySelector(`[id="${CSS.escape(target)}"]`)
        ?.scrollIntoView({ block: "start" });
    }
  };

  return (
    <article
      ref={box}
      aria-label="Markdown preview"
      onClick={onClick}
      className="z-md size-full overflow-auto px-8 py-6"
      // Rendered from the Tab's text and sanitized (render.ts).
      dangerouslySetInnerHTML={{ __html: html ?? "" }}
    />
  );
}
