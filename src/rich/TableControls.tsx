/**
 * The table control: shown in the toolbar, beside its Table item, while the
 * cursor is in a table,
 * with a menu to add and delete rows and columns, or the table.
 */
import { useEffect, useState } from "react";
import { isInTable } from "@milkdown/kit/prose/tables";
import { ChevronDown } from "lucide-react";
import { Icon } from "../ui/icons";
import { Menu, type MenuItem } from "../ui/Menu";
import { canTable, table, type TableAction } from "./commands";
import { useRich, useRichState } from "./richContext";

const ACTIONS: [TableAction, string, boolean?][] = [
  ["rowAbove", "Add row above"],
  ["rowBelow", "Add row below"],
  ["colLeft", "Add column left"],
  ["colRight", "Add column right"],
  ["delRow", "Delete row", true],
  ["delCol", "Delete column"],
  ["delTable", "Delete table", true],
];

export function TableControls() {
  const rich = useRich()!;
  const { view, readOnly } = rich;
  const state = useRichState(rich);
  const inTable = isInTable(state);
  /** The open menu's anchor. */
  const [at, setAt] = useState<DOMRect | null>(null);

  // Leaving the table closes the menu.
  useEffect(
    () =>
      rich.subscribe(() => {
        if (!isInTable(view.state)) setAt(null);
      }),
    [rich, view],
  );

  if (!inTable) return null;

  const items: MenuItem[] = ACTIONS.map(([action, label, separated]) => ({
    label,
    separated,
    disabled: readOnly || !canTable(state, action),
    onSelect: () => {
      table(view, action);
      view.focus();
    },
  }));

  return (
    <>
      <button
        type="button"
        aria-label="Table options"
        title="Table options"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        disabled={readOnly}
        data-table-control=""
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) =>
          setAt(at ? null : e.currentTarget.getBoundingClientRect())
        }
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] bg-accent-tint pl-2 pr-1.5 text-[13px] text-accent hover:bg-accent-soft disabled:bg-transparent disabled:text-faint"
      >
        <Icon name="insertTable" size={15} />
        <span>Table</span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {at && !readOnly && (
        <Menu
          label="Table"
          x={at.left}
          y={at.bottom + 4}
          items={items}
          ignoreSelector="[data-table-control]"
          onDismiss={(chose) => {
            setAt(null);
            if (!chose) view.focus();
          }}
        />
      )}
    </>
  );
}
