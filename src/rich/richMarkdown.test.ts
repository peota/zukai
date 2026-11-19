import { describe, expect, it } from "vitest";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";
import { canKeep, richPlugins, roundTrip } from "./richMarkdown";

/** One sample per kind of content the rich editor must keep. */
const CORPUS: Record<string, string> = {
  headings: [
    "# One",
    "",
    "## Two",
    "",
    "### Three",
    "",
    "#### Four",
    "",
    "##### Five",
    "",
    "###### Six",
  ].join("\n"),
  nestedLists: [
    "- apple",
    "  - banana",
    "    1. cherry",
    "    2. damson",
    "- elder",
    "",
    "3. fig",
    "4. grape",
    "   - hazel",
  ].join("\n"),
  taskLists: [
    "- [ ] open task",
    "- [x] closed task",
    "  - [ ] nested task",
  ].join("\n"),
  table: [
    "| Left | Center | Right |",
    "|:-----|:------:|------:|",
    "| l1 | c1 | r1 |",
    "| l2 | c2 | r2 |",
  ].join("\n"),
  codeFence: [
    "```ts",
    "const answer: number = 42;",
    "  // indented",
    "```",
  ].join("\n"),
  quoteWithList: [
    "> quoted words",
    "> - quoted item",
    ">   - deeper item",
  ].join("\n"),
  links: [
    'An [inline link](https://example.com/path "Title") here,',
    "an autolink <https://auto.example.com>,",
    "and a bare www.bare-example.com address.",
  ].join("\n"),
  image: "Look: ![alt words](x.png)",
  frontMatter: [
    "---",
    "title: Front matter title",
    "tags: [alpha, beta]",
    "---",
    "",
    "# Body heading",
  ].join("\n"),
  htmlBlock: ["<div>", "raw html words", "</div>", "", "after the div"].join(
    "\n",
  ),
  inlineMarks: "Some **bold** and *italic* and ~~struck~~ and `inline code`.",
  horizontalRule: ["above the rule", "", "---", "", "below the rule"].join(
    "\n",
  ),
};

/** Runs `body` against a rich editor showing `text`. */
async function withEditor(
  text: string,
  body: (editor: Editor) => void,
): Promise<void> {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement("div"));
      ctx.set(defaultValueCtx, text);
    })
    .use(richPlugins());
  await editor.create();
  try {
    body(editor);
  } finally {
    await editor.destroy();
  }
}

const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? [];

describe("richMarkdown", () => {
  it("round_trip_keeps_content", async () => {
    for (const [name, text] of Object.entries(CORPUS)) {
      const out = await roundTrip(text);
      for (const word of words(text)) {
        expect(out, `${name}: "${word}" lost`).toContain(word);
      }
      expect(await canKeep(text), `${name}: canKeep\n${out}`).toBe(true);
    }
  });

  it("raw_blocks_are_kept_exactly", async () => {
    // Front matter and block HTML are raw blocks in the editor, not
    // headings, rules or inline HTML, and come back as they were.
    await withEditor(
      `${CORPUS.frontMatter}\n\n${CORPUS.htmlBlock}`,
      (editor) => {
        const types: string[] = [];
        editor.action((ctx) =>
          ctx.get(editorViewCtx).state.doc.forEach((node) => {
            types.push(
              node.type.name === "zukai_raw"
                ? `raw:${String(node.attrs.kind)}`
                : node.type.name,
            );
          }),
        );
        expect(types).toEqual(["raw:yaml", "heading", "raw:html", "paragraph"]);
      },
    );
    expect(await roundTrip(CORPUS.frontMatter)).toBe(`${CORPUS.frontMatter}\n`);
    expect(await roundTrip(CORPUS.htmlBlock)).toBe(`${CORPUS.htmlBlock}\n`);
  });

  it("formatting_only_differences_are_kept", async () => {
    expect(await canKeep("* a\n* b")).toBe(true);
    expect(await roundTrip("* a\n* b")).toBe("- a\n- b\n");
  });

  it("cannot_keep_detects_loss", async () => {
    // Milkdown's commonmark preset runs remark-inline-links, which resolves
    // a reference-style link into an inline one and drops the definition:
    // "[ref][1]\n\n[1]: https://x.com" comes back as "[ref](https://x.com)".
    // The words survive, but the definition (and every other use of it) is
    // gone, so the note must stay in the plain editor.
    const text = "See [the docs][1].\n\n[1]: https://example.com/docs";
    expect(await roundTrip(text)).not.toContain("[1]:");
    expect(await canKeep(text)).toBe(false);

    // The code block keeps only a fence's language: its meta ("title=…")
    // is dropped.
    const meta = '```ts title="a.ts"\nconst a = 1;\n```';
    expect(await roundTrip(meta)).toBe("```ts\nconst a = 1;\n```\n");
    expect(await canKeep(meta)).toBe(false);
  });

  it("pasted_html_serializes_cleanly", async () => {
    await withEditor("", (editor) => {
      const html = [
        "<h2>Pasted title</h2>",
        "<ul><li>first</li><li>second</li></ul>",
        "<table><thead><tr><th>h1</th><th>h2</th></tr></thead>",
        "<tbody><tr><td>c1</td><td>c2</td></tr></tbody></table>",
        "<p>some <b>bold</b> text</p>",
      ].join("");
      // jsdom has no ClipboardEvent; a paste event carrying the clipboard
      // (HTML plus its plain text, as a browser gives it) goes through the
      // same path, Milkdown's clipboard plugin included.
      const data: Record<string, string> = {
        "text/html": html,
        "text/plain": "Pasted title first second h1 h2 c1 c2 some bold text",
      };
      const event = Object.assign(new Event("paste"), {
        clipboardData: { getData: (type: string) => data[type] ?? "" },
      }) as unknown as ClipboardEvent;
      editor.action((ctx) => ctx.get(editorViewCtx).pasteHTML(html, event));
      const md = editor.action(getMarkdown());
      expect(md).toMatch(/^## Pasted title$/m);
      expect(md).toMatch(/^- first$/m);
      expect(md).toMatch(/^- second$/m);
      expect(md).toMatch(/^\| h1 +\| h2 +\|$/m);
      // Milkdown gives pasted columns its default (left) alignment.
      expect(md).toMatch(/^\| :?-+:? \| :?-+:? \|$/m);
      expect(md).toMatch(/^\| c1 +\| c2 +\|$/m);
      expect(md).toContain("some **bold** text");
    });
  });
});
