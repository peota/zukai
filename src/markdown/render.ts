import DOMPurify from "dompurify";
import { Marked } from "marked";

const md = new Marked({ gfm: true, breaks: false, async: false });

/**
 * A link the preview may open: web and mail links (in the browser) and
 * links to a heading of the same page. Anything else (a file path,
 * `javascript:`) is shown but does nothing.
 */
export function linkKind(href: string): "web" | "anchor" | null {
  const h = href.trim();
  if (h.startsWith("#")) return "anchor";
  return /^(https?:\/\/|mailto:)/i.test(h) ? "web" : null;
}

/** A heading's anchor id, as GitHub makes them ("Hello, World" → "hello-world"). */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

const purifier = DOMPurify();
purifier.addHook("afterSanitizeAttributes", (node) => {
  // Images aren't loaded (the app fetches nothing from the web, and local
  // paths aren't readable from the page): their alt text stands in.
  if (node.tagName === "IMG") {
    const alt = node.getAttribute("alt") ?? "";
    const span = node.ownerDocument.createElement("span");
    span.className = "z-md-img";
    span.textContent = alt ? `[image: ${alt}]` : "[image]";
    node.replaceWith(span);
    return;
  }
  // A task list's box ("- [x] done") stays, read-only; no other input does.
  if (node.tagName === "INPUT") {
    if (node.getAttribute("type") === "checkbox") {
      node.setAttribute("disabled", "");
    } else {
      node.remove();
    }
    return;
  }
  if (/^H[1-6]$/.test(node.tagName) && !node.id) {
    node.id = slug(node.textContent ?? "");
  }
  if (node.tagName === "A") node.setAttribute("rel", "noreferrer");
});

/**
 * `text` as safe HTML: GitHub-flavored Markdown, with raw HTML in it kept
 * only to a harmless subset (no scripts, event handlers, styles, frames or
 * forms).
 */
export function renderMarkdown(text: string): string {
  const html = md.parse(text) as string;
  return purifier.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "button", "iframe", "textarea", "select"],
    FORBID_ATTR: ["style"],
  });
}
