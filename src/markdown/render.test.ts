import { describe, expect, it } from "vitest";
import { linkKind, renderMarkdown, slug } from "./render";

const dom = (text: string) => {
  const div = document.createElement("div");
  div.innerHTML = renderMarkdown(text);
  return div;
};

describe("renderMarkdown", () => {
  it("renders GitHub-flavored Markdown", () => {
    const d = dom(
      [
        "# Func",
        "* add **zoom**",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "~~gone~~",
      ].join("\n"),
    );
    expect(d.querySelector("h1")?.textContent).toBe("Func");
    expect(d.querySelector("h1")?.id).toBe("func");
    expect(d.querySelector("li strong")?.textContent).toBe("zoom");
    expect(d.querySelectorAll("table td")).toHaveLength(2);
    expect(d.querySelector("pre code")?.textContent).toBe("const x = 1;\n");
    expect(d.querySelector("del")?.textContent).toBe("gone");
  });

  it("keeps harmless raw HTML and drops anything that could run or load", () => {
    const d = dom(
      [
        "<b>bold</b>",
        '<script>alert(1)</script><img src=x onerror="alert(2)">',
        '<a href="javascript:alert(3)">x</a>',
        '<iframe src="https://example.com"></iframe>',
        '<p style="color:red" onclick="alert(4)">p</p>',
        "<form><input></form>",
      ].join("\n\n"),
    );
    expect(d.querySelector("b")?.textContent).toBe("bold");
    expect(d.querySelector("script, iframe, form, input, img")).toBeNull();
    // HTML only: no SVG or MathML (their own script and link paths).
    expect(
      dom('<svg><a href="#x"><text>t</text></a></svg>').querySelector("svg"),
    ).toBeNull();
    // Task lists keep their boxes, which can't be ticked.
    const tasks = dom("- [x] done\n- [ ] todo");
    const boxes = tasks.querySelectorAll("input");
    expect(boxes).toHaveLength(2);
    expect([...boxes].every((b) => b.type === "checkbox" && b.disabled)).toBe(
      true,
    );
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect(d.innerHTML).not.toMatch(/onerror|onclick|javascript:|style=/i);
  });

  it("shows an image's alt text instead of loading it", () => {
    const d = dom("![a cat](https://example.com/cat.png) ![](local.png)");
    expect(d.querySelector("img")).toBeNull();
    expect(
      [...d.querySelectorAll(".z-md-img")].map((s) => s.textContent),
    ).toEqual(["[image: a cat]", "[image]"]);
  });
});

describe("links", () => {
  it("knows which links it may open", () => {
    expect(linkKind("https://zukai.app")).toBe("web");
    expect(linkKind("HTTP://x")).toBe("web");
    expect(linkKind("mailto:a@b.c")).toBe("web");
    expect(linkKind("#design")).toBe("anchor");
    expect(linkKind("javascript:alert(1)")).toBeNull();
    expect(linkKind("C:/notes/a.md")).toBeNull();
    expect(linkKind("file:///etc/passwd")).toBeNull();
  });

  it("slugs headings like GitHub", () => {
    expect(slug("Hello, World")).toBe("hello-world");
    expect(slug("  Zoom in / out ")).toBe("zoom-in--out");
  });
});
