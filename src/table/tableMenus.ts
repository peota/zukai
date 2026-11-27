import type { MenuItem } from "../ui/Menu";
import type { GridSelection } from "./Grid";
import type { SortDir, TableSort } from "./view";

/** What the gutter and header menus act through. Each call reads the current table. */
export interface MenuCtx {
  readOnly: boolean;
  header: boolean;
  sort?: TableSort;
  insertRow(side: "above" | "below"): void;
  deleteRows(): void;
  insertColumn(side: "left" | "right"): void;
  deleteColumn(): void;
  renameColumn(): void;
  sortBy(dir: SortDir): void;
}

const READ_ONLY = "Read-only";

/** Disabled with a reason when read-only. */
const edit = (ctx: MenuCtx, item: MenuItem): MenuItem =>
  ctx.readOnly ? { ...item, disabled: true, reason: READ_ONLY } : item;

/** The gutter menu: insert row above/below, delete the selected row(s). */
export function rowMenu(sel: GridSelection, ctx: MenuCtx): MenuItem[] {
  const n = sel.rows && !sel.cols ? sel.rows.length : 1;
  return [
    edit(ctx, {
      label: "Insert row above",
      onSelect: () => ctx.insertRow("above"),
    }),
    edit(ctx, {
      label: "Insert row below",
      onSelect: () => ctx.insertRow("below"),
    }),
    edit(ctx, {
      label: n > 1 ? "Delete rows" : "Delete row",
      separated: true,
      onSelect: ctx.deleteRows,
    }),
  ];
}

/** The header menu for column `sel.col`. */
export function columnMenu(sel: GridSelection, ctx: MenuCtx): MenuItem[] {
  const dir = ctx.sort?.col === sel.col ? ctx.sort.dir : undefined;
  const items: MenuItem[] = [];
  if (ctx.header)
    items.push(
      edit(ctx, { label: "Rename column", onSelect: ctx.renameColumn }),
    );
  items.push(
    edit(ctx, {
      label: "Insert column left",
      separated: ctx.header,
      onSelect: () => ctx.insertColumn("left"),
    }),
    edit(ctx, {
      label: "Insert column right",
      onSelect: () => ctx.insertColumn("right"),
    }),
    edit(ctx, {
      label: "Delete column",
      onSelect: ctx.deleteColumn,
    }),
    {
      label: "Sort ascending",
      separated: true,
      checked: dir === "asc",
      onSelect: () => ctx.sortBy("asc"),
    },
    {
      label: "Sort descending",
      checked: dir === "desc",
      onSelect: () => ctx.sortBy("desc"),
    },
  );
  return items;
}
