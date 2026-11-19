import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { canKeep } from "./richMarkdown";
import { mountRich, select, tablesIn } from "./richTestKit";

const button = (name: string) => screen.getByRole("button", { name });

describe("RichToolbar", () => {
  it("toolbar_h2_bold_list_task", async () => {
    const { view, md } = await mountRich("one\n\ntwo\n");
    act(() => select(view, "one", 1));
    fireEvent.click(button("Heading 2"));
    expect(md()).toBe("## one\n\ntwo\n");
    expect(button("Heading 2")).toHaveAttribute("aria-pressed", "true");
    expect(button("Paragraph")).toHaveAttribute("aria-pressed", "false");

    act(() => select(view, "one"));
    fireEvent.click(button("Bold"));
    expect(md()).toBe("## **one**\n\ntwo\n");
    expect(button("Bold")).toHaveAttribute("aria-pressed", "true");

    act(() => select(view, "two", 1));
    fireEvent.click(button("Bulleted list"));
    expect(md()).toBe("## **one**\n\n- two\n");
    expect(button("Bulleted list")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button("Checklist"));
    expect(md()).toBe("## **one**\n\n- [ ] two\n");
    expect(button("Checklist")).toHaveAttribute("aria-pressed", "true");
    expect(button("Bulleted list")).toHaveAttribute("aria-pressed", "false");
  });

  it("toolbar_disabled_when_read_only", async () => {
    const { view, md } = await mountRich("one\n", { readOnly: true });
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = bar.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(16);
    for (const b of buttons) expect(b).toBeDisabled();
    act(() => select(view, "one"));
    fireEvent.keyDown(view.dom, { key: "k", code: "KeyK", ctrlKey: true });
    expect(screen.queryByRole("textbox", { name: "Link URL" })).toBeNull();
    expect(md()).toBe("one\n");
  });

  it("mod_k_inserts_link", async () => {
    const { view, md } = await mountRich("see docs\n");
    act(() => select(view, "docs"));
    const ev = fireEvent.keyDown(view.dom, {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
    });
    // Used here: the app doesn't also act on it.
    expect(ev).toBe(false);
    const input = screen.getByRole("textbox", { name: "Link URL" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "https://example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(md()).toBe("see [docs](https://example.com)\n");
    expect(screen.queryByRole("textbox", { name: "Link URL" })).toBeNull();
  });

  it("mod_shift_x_strikes_and_mod_b_is_milkdowns", async () => {
    const { view, md } = await mountRich("one\n");
    act(() => select(view, "one"));
    fireEvent.keyDown(view.dom, {
      key: "X",
      code: "KeyX",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(md()).toBe("~~one~~\n");
    // Mod+B is bold here, and taken (so the Sidebar doesn't toggle).
    const ev = fireEvent.keyDown(view.dom, {
      key: "b",
      code: "KeyB",
      ctrlKey: true,
    });
    expect(ev).toBe(false);
    expect(md()).toBe("**~~one~~**\n");
  });

  it("toolbar_wraps_and_table_control_follows_table", async () => {
    const { view } = await mountRich("| a |\n| - |\n| 1 |\n");
    act(() => select(view, "1", 1));
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    // A narrow pane (a Split) wraps onto a second row; nothing scrolls away.
    expect(bar.className).toMatch(/\bflex-wrap\b/);
    expect(bar.className).not.toMatch(/overflow-x-(auto|scroll)/);
    // Each group stays together on its row.
    const groups = bar.querySelectorAll(":scope > [role=group]");
    expect(groups.length).toBeGreaterThanOrEqual(4);
    for (const g of groups) expect(g.className).toMatch(/\bshrink-0\b/);
    const names = [...bar.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(names.indexOf("Table options")).toBe(names.indexOf("Table") + 1);
    expect(button("Table options").closest("[role=group]")).toBe(
      button("Table").closest("[role=group]"),
    );
  });

  it("new_table_is_3x2_with_header", async () => {
    const { view, md } = await mountRich("intro\n");
    act(() => select(view, "intro", 5));
    fireEvent.click(button("Table"));
    const text = md();
    const tables = tablesIn(text);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toHaveLength(2);
    for (const row of tables[0]) expect(row).toHaveLength(3);
    // A header row, its delimiter row, and one body row.
    expect(text).toMatch(/^\|[^\n]*\|\n\|(?: *-+ *\|){3}\n\|[^\n]*\|\n/m);
    expect(text.startsWith("intro\n\n")).toBe(true);
    expect(await canKeep(text)).toBe(true);
    // The cursor is in the first header cell.
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(view.state.selection.$from.node(-1).type.name).toBe("table_header");
  });
});
