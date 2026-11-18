import type { FileFormat } from "../model/types";
import { Menu, type MenuItem } from "./Menu";

export interface FileFormatMenuProps {
  kind: "encoding" | "lineEnding";
  /** The status-bar chip it opens above. */
  anchor: DOMRect;
  format: FileFormat;
  /** The Tab has edits not yet in the File: no Reopen. */
  pending: boolean;
  readonly: boolean;
  /** Its unsaved text can't be read yet: nothing may change it. */
  unreadable: boolean;
  onReopenWithEncoding(): void;
  onConvertTo(): void;
  onConvert(patch: Partial<FileFormat>): void;
  onDismiss(chose?: boolean): void;
}

const UNREADABLE = "Its unsaved text can't be read yet";
const READONLY = "The file is open read-only";

/**
 * The Encoding and Line ending menus of the status bar (spec 5.13).
 * Whether text fits a narrower encoding isn't known here: a Convert that
 * can't be written is refused by the save and shows the unencodable bar.
 */
export function FileFormatMenu(p: FileFormatMenuProps) {
  const blocked = p.unreadable ? UNREADABLE : p.readonly ? READONLY : null;
  const f = p.format;
  const isUtf8 = f.encoding === "utf-8";
  const convertItem = (
    label: string,
    patch: Partial<FileFormat>,
    current: boolean,
  ): MenuItem => ({
    label,
    checked: current,
    disabled: current || blocked !== null,
    reason: current ? undefined : (blocked ?? undefined),
    onSelect: () => p.onConvert(patch),
  });

  const items: MenuItem[] =
    p.kind === "encoding"
      ? [
          {
            label: "Reopen with encoding…",
            disabled: p.unreadable || p.pending,
            reason: p.unreadable
              ? UNREADABLE
              : p.pending
                ? "Not while there are unsaved edits"
                : undefined,
            onSelect: p.onReopenWithEncoding,
          },
          {
            ...convertItem(
              "Convert to UTF-8",
              { encoding: "utf-8", bom: false },
              isUtf8 && !f.bom,
            ),
            separated: true,
          },
          convertItem(
            "Convert to UTF-8 with BOM",
            { encoding: "utf-8", bom: true },
            isUtf8 && f.bom,
          ),
          {
            label: "Convert to…",
            disabled: blocked !== null,
            reason: blocked ?? undefined,
            onSelect: p.onConvertTo,
          },
        ]
      : [
          convertItem(
            "Convert to LF",
            { lineEnding: "lf", mixed: false },
            !f.mixed && f.lineEnding === "lf",
          ),
          convertItem(
            "Convert to CRLF",
            { lineEnding: "crlf", mixed: false },
            !f.mixed && f.lineEnding === "crlf",
          ),
        ];

  return (
    <Menu
      label={p.kind === "encoding" ? "Encoding" : "Line ending"}
      heading={p.kind === "encoding" ? "ENCODING" : "LINE ENDING"}
      x={p.anchor.right}
      y={p.anchor.top - 4}
      side="above"
      align="end"
      ignoreSelector={`[data-menu-anchor="${p.kind}"]`}
      items={items}
      onDismiss={p.onDismiss}
    />
  );
}
