import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mountRich, select, tablesIn } from "./richTestKit";

const TABLE = "intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\noutro\n";

const control = () => screen.queryByRole("button", { name: "Table options" });

/** Opens the table menu and picks `label`. */
function pick(label: string) {
  fireEvent.click(control()!);
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("TableControls", () => {
  it("shown_only_in_a_table", async () => {
    const { view } = await mountRich(TABLE);
    act(() => select(view, "intro", 1));
    expect(control()).toBeNull();
    act(() => select(view, "1", 1));
    expect(control()).not.toBeNull();
  });

  it("table_add_row_and_column", async () => {
    const { view, md } = await mountRich(TABLE);
    act(() => select(view, "1", 1));
    pick("Add row below");
    expect(tablesIn(md())).toEqual([
      [
        ["a", "b"],
        ["1", "2"],
        ["", ""],
      ],
    ]);
    act(() => select(view, "1", 1));
    pick("Add row above");
    pick("Add column right");
    expect(tablesIn(md())).toEqual([
      [
        ["a", "", "b"],
        ["", "", ""],
        ["1", "", "2"],
        ["", "", ""],
      ],
    ]);
    act(() => select(view, "b", 1));
    pick("Add column left");
    expect(tablesIn(md())[0][0]).toEqual(["a", "", "", "b"]);
    // No row above the header: GFM's header is always the first row.
    fireEvent.click(control()!);
    expect(
      screen.getByRole("menuitem", { name: "Add row above" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(md()).toMatch(/^\| a +\| +\| +\| b +\|\n\|(?: *-+ *\|){4}\n/m);
  });

  it("table_delete_row_and_column", async () => {
    const { view, md } = await mountRich(
      "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n",
    );
    act(() => select(view, "3", 1));
    pick("Delete row");
    act(() => select(view, "2", 1));
    pick("Delete column");
    expect(tablesIn(md())).toEqual([[["a"], ["1"]]]);
  });

  it("table_delete_table", async () => {
    const { view, md } = await mountRich(TABLE);
    act(() => select(view, "2", 1));
    pick("Delete table");
    expect(md()).toBe("intro\n\noutro\n");
    expect(tablesIn(md())).toEqual([]);
    expect(control()).toBeNull();
  });
});
