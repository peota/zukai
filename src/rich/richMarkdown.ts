/**
 * The rich (Milkdown) Markdown editor's configuration, and the round-trip
 * check that decides whether a note may be shown in it.
 *
 * Load this module lazily (`import("./richMarkdown")`): it pulls in
 * Milkdown, ProseMirror and remark, which stay out of the main bundle.
 */
import type { MilkdownPlugin, SliceType } from "@milkdown/kit/ctx";
import {
  Editor,
  defaultValueCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import {
  bulletListKeymap,
  codeBlockKeymap,
  commonmark,
  headingKeymap,
  orderedListKeymap,
  paragraphKeymap,
  remarkPreserveEmptyLinePlugin,
} from "@milkdown/kit/preset/commonmark";
import { gfm, strikethroughKeymap } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener } from "@milkdown/kit/plugin/listener";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { $nodeSchema, $remark, getMarkdown } from "@milkdown/kit/utils";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";

/** An mdast node, as far as this module looks at one. */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: unknown;
  [key: string]: unknown;
};

/**
 * Front matter: a `---` line first in the file, up to the next `---` line.
 * (The same rule as remark-frontmatter's YAML.)
 */
const FRONT_MATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** The mdast type a block of HTML becomes in the editor, so it stays a block. */
const RAW_HTML = "zukaiRawHtml";

/** Containers whose `html` children are blocks (not inline HTML). */
const FLOW_CONTAINERS = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
]);

function rawHtmlBlocks(node: MdNode): void {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.type === "html" && FLOW_CONTAINERS.has(node.type)) {
      child.type = RAW_HTML;
    } else {
      rawHtmlBlocks(child);
    }
  }
}

/**
 * A remark plugin that parses front matter into a `yaml` node and writes it
 * back as it was. With `{ rawHtml: true }` it also marks block HTML, so the
 * editor can keep it as a raw block (instead of Milkdown's inline HTML).
 *
 * It wraps the parser rather than adding a micromark extension: the front
 * matter is blanked out (same length, so every offset stays right), the rest
 * is parsed as usual, and the `yaml` node is put first.
 */
function remarkFrontMatter(
  this: Processor,
  options?: { rawHtml?: boolean },
): void {
  const parse = this.parser;
  if (!parse) throw new Error("remarkFrontMatter needs remark-parse first");
  this.parser = (doc, file) => {
    const match = FRONT_MATTER.exec(doc);
    const blanked = match
      ? match[0].replace(/[^\r\n]/g, " ") + doc.slice(match[0].length)
      : doc;
    const tree = parse(blanked, file) as unknown as MdNode;
    if (options?.rawHtml) rawHtmlBlocks(tree);
    if (match) {
      const yaml: MdNode = { type: "yaml", value: match[1] ?? "" };
      tree.children = [yaml, ...(tree.children ?? [])];
    }
    return tree as unknown as ReturnType<typeof parse>;
  };

  const data = this.data();
  const extensions = (data.toMarkdownExtensions ??= []);
  extensions.push({
    handlers: {
      yaml: (node: { value?: string }) =>
        node.value ? `---\n${node.value}\n---` : "---\n---",
    },
  } as unknown as (typeof extensions)[number]);
}

const frontMatterRemark = $remark("zukaiFrontMatter", () => remarkFrontMatter, {
  rawHtml: true,
});

/**
 * Front matter and block HTML, kept as raw, editable code-like blocks and
 * written back exactly.
 */
const rawBlockSchema = $nodeSchema("zukai_raw", () => ({
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  attrs: { kind: { default: "html", validate: "string" } },
  parseDOM: [
    {
      tag: "pre[data-raw]",
      preserveWhitespace: "full" as const,
      priority: 60,
      getAttrs: (dom: HTMLElement) => ({
        kind: dom.dataset.raw === "yaml" ? "yaml" : "html",
      }),
    },
  ],
  toDOM: (node) => [
    "pre",
    { "data-raw": node.attrs.kind as string, class: "z-rich-raw" },
    ["code", 0],
  ],
  parseMarkdown: {
    match: (node) => node.type === "yaml" || node.type === RAW_HTML,
    runner: (state, node, type) => {
      state.openNode(type, { kind: node.type === "yaml" ? "yaml" : "html" });
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "zukai_raw",
    runner: (state, node) => {
      const type = node.attrs.kind === "yaml" ? "yaml" : "html";
      state.addNode(type, undefined, node.textContent);
    },
  },
}));

/**
 * `-` for bullets and `---` for rules, as people mostly write them. Set as
 * the editor starts, before the init plugin reads the options.
 */
const stringifyOptions: MilkdownPlugin = (ctx) => () => {
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    bullet: "-" as const,
    rule: "-" as const,
  }));
};

/**
 * Milkdown's Mod-Alt keys (paragraph, headings, lists, code block,
 * strikethrough) go: Ctrl+Alt is AltGr on Windows and Linux, so they would
 * turn typed characters ("{", "[", "ć") into blocks and marks.
 */
const ALTGR_KEYMAPS = [
  paragraphKeymap,
  headingKeymap,
  orderedListKeymap,
  bulletListKeymap,
  codeBlockKeymap,
  strikethroughKeymap,
];
type KeymapConfig = Record<
  string,
  { shortcuts: string | string[]; priority?: number }
>;
const noAltGrKeys: MilkdownPlugin = (ctx) => () => {
  for (const keymap of ALTGR_KEYMAPS) {
    ctx.update(keymap.key as unknown as SliceType<KeymapConfig>, (items) =>
      Object.fromEntries(
        Object.entries(items).map(([name, item]) => [
          name,
          {
            ...item,
            shortcuts: [item.shortcuts]
              .flat()
              .filter((k) => !/^Mod-Alt-/.test(k)),
          },
        ]),
      ),
    );
  }
};

/**
 * The commonmark preset without its empty-line placeholder: it writes an
 * empty paragraph as `<br />` into the note, and would read a block `<br>`
 * back as an empty paragraph rather than the raw HTML it is.
 */
const commonmarkPlugins = (): MilkdownPlugin[] => {
  const skip = new Set<MilkdownPlugin>(remarkPreserveEmptyLinePlugin);
  return commonmark.filter((plugin) => !skip.has(plugin));
};

/** Everything the rich editor is built from. */
export function richPlugins(): MilkdownPlugin[] {
  return [
    stringifyOptions,
    noAltGrKeys,
    frontMatterRemark,
    rawBlockSchema,
    commonmarkPlugins(),
    gfm,
    history,
    listener,
    clipboard,
  ].flat();
}

/** `text` parsed and serialized exactly as the rich editor would. */
export async function roundTrip(text: string): Promise<string> {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement("div"));
      ctx.set(defaultValueCtx, text);
    })
    .use(richPlugins());
  await editor.create();
  try {
    return editor.action(getMarkdown());
  } finally {
    await editor.destroy();
  }
}

const reference = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontMatter);

/**
 * A syntax tree without what's only formatting. Positions go; list markers,
 * emphasis markers, table padding, fence characters and trailing whitespace
 * aren't in the tree to begin with.
 */
function normalize(node: MdNode): unknown {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    const value = node[key];
    if (key === "position" || value === undefined) continue;
    out[key] = key === "children" ? (value as MdNode[]).map(normalize) : value;
  }
  return out;
}

const tree = (text: string) =>
  JSON.stringify(normalize(reference.parse(text) as unknown as MdNode));

/**
 * Whether the rich editor keeps everything in `text`: true when the syntax
 * trees of `text` and its round trip are the same but for formatting. When
 * in doubt (anything throws), false.
 */
export async function canKeep(text: string): Promise<boolean> {
  try {
    return tree(text) === tree(await roundTrip(text));
  } catch {
    return false;
  }
}
