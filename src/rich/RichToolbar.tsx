/**
 * The rich editor's slim toolbar: block types, marks, a link, lists and
 * blocks to insert, reflecting the selection. Also owns the keys Milkdown
 * doesn't bind: Mod+Shift+X (strike) and Mod+K (link).
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { EditorView } from "@milkdown/kit/prose/view";
import { detectPlatform, letterOf } from "../app/shortcuts";
import { formatKeys } from "../app/shortcutList";
import { Icon, type IconName } from "../ui/icons";
import {
  BLOCK_ITEMS,
  activeIn,
  setLink,
  toggleMark,
  type BlockItem,
  type MarkKind,
} from "./commands";
import { useRich, useRichState } from "./richContext";
import { TableControls } from "./TableControls";

const platform = detectPlatform();
const mac = platform === "mac";
const keys = (...k: string[]) => formatKeys(["Mod", ...k], platform);

const BUTTON =
  "flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[4px] px-1 text-[12px] text-muted hover:bg-chrome hover:text-text aria-pressed:bg-chrome aria-pressed:text-text disabled:text-faint disabled:hover:bg-transparent";

function Tool(p: {
  label: string;
  hint?: string;
  pressed?: boolean;
  disabled: boolean;
  onRun(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={p.label}
      title={p.hint ? `${p.label} (${p.hint})` : p.label}
      aria-pressed={p.pressed}
      disabled={p.disabled}
      // The editor keeps the focus and the selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onRun}
      className={BUTTON}
    >
      {p.children}
    </button>
  );
}

/**
 * Items that stay together when the toolbar wraps (a narrow Split), each
 * after the first set off by a hairline.
 */
const Group = ({
  first,
  children,
}: {
  first?: boolean;
  children: ReactNode;
}) => (
  <div
    role="group"
    className={
      "flex shrink-0 items-center gap-0.5" +
      (first ? "" : " border-l border-hairline pl-1")
    }
  >
    {children}
  </div>
);

const MARK_TOOLS: [MarkKind, string, string, ReactNode][] = [
  ["bold", "Bold", keys("B"), <b key="b">B</b>],
  ["italic", "Italic", keys("I"), <i key="i">I</i>],
  ["strike", "Strikethrough", keys("Shift", "X"), <s key="s">S</s>],
  ["code", "Inline code", keys("E"), <Icon key="c" name="code" />],
];

const BLOCK_TOOLS: [keyof typeof BLOCK_ITEMS, ReactNode][] = [
  ["paragraph", <Icon key="p" name="paragraph" />],
  ["h1", <span key="1">H1</span>],
  ["h2", <span key="2">H2</span>],
  ["h3", <span key="3">H3</span>],
];

const INSERT_TOOLS: [keyof typeof BLOCK_ITEMS, IconName][][] = [
  [
    ["bullet", "bulletList"],
    ["ordered", "numberedList"],
    ["task", "checklist"],
  ],
  [
    ["quote", "quote"],
    ["code", "codeBlock"],
    ["table", "table"],
    ["rule", "rule"],
  ],
];

/** The href of the link at the cursor, or "". */
function linkHere(view: EditorView): string {
  const { state } = view;
  const type = state.schema.marks.link;
  const { $from, from, to, empty } = state.selection;
  let mark = type.isInSet($from.marks());
  if (!empty && !mark) {
    state.doc.nodesBetween(from, to, (n) => {
      mark ??= type.isInSet(n.marks);
    });
  }
  return (mark?.attrs.href as string | undefined) ?? "";
}

export function RichToolbar() {
  const rich = useRich()!;
  const { view, readOnly } = rich;
  const a = activeIn(useRichState(rich));
  /** The link input's text while it's open. */
  const [href, setHref] = useState<string | null>(null);

  const done = () => view.focus();
  const block = (item: BlockItem) => () => {
    item.run(view);
    done();
  };

  const openLink = useCallback(() => {
    if (view.state.selection.$from.parent.type.spec.code) return;
    setHref(linkHere(view));
  }, [view]);

  const closeLink = (apply: boolean) => {
    if (apply && href !== null) setLink(view, href);
    setHref(null);
    done();
  };

  // Keys Milkdown doesn't bind, before ProseMirror sees them.
  useEffect(() => {
    if (readOnly) return;
    const host = view.dom.parentElement ?? view.dom;
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== view.dom && !view.dom.contains(e.target as Node)) return;
      const mod = mac ? e.metaKey : e.ctrlKey;
      const other = mac ? e.ctrlKey : e.metaKey;
      if (!mod || other || e.altKey) return;
      const letter = letterOf(e);
      if (e.shiftKey && letter === "x") toggleMark(view, "strike");
      else if (!e.shiftKey && letter === "k") openLink();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    host.addEventListener("keydown", onKey, true);
    return () => host.removeEventListener("keydown", onKey, true);
  }, [view, readOnly, openLink]);

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex min-h-8 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-hairline bg-editor px-3 py-1"
    >
      <Group first>
        {BLOCK_TOOLS.map(([id, glyph]) => (
          <Tool
            key={id}
            label={BLOCK_ITEMS[id].label}
            pressed={BLOCK_ITEMS[id].on(a)}
            disabled={readOnly || a.inTable}
            onRun={block(BLOCK_ITEMS[id])}
          >
            {glyph}
          </Tool>
        ))}
      </Group>
      <Group>
        {MARK_TOOLS.map(([kind, label, hint, glyph]) => (
          <Tool
            key={kind}
            label={label}
            hint={hint}
            pressed={a.marks.has(kind)}
            disabled={readOnly || a.block === "code"}
            onRun={() => {
              toggleMark(view, kind);
              done();
            }}
          >
            {glyph}
          </Tool>
        ))}
        <Tool
          label="Link"
          hint={keys("K")}
          pressed={a.marks.has("link")}
          disabled={readOnly || a.block === "code"}
          onRun={openLink}
        >
          <Icon name="link" />
        </Tool>
      </Group>
      {href !== null && (
        <input
          aria-label="Link URL"
          autoFocus
          value={href}
          placeholder="https://…"
          spellCheck={false}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") closeLink(true);
            else if (e.key === "Escape") closeLink(false);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
          onBlur={() => setHref(null)}
          // Never wider than the toolbar, so it fits a narrow Split.
          className="h-6 w-56 max-w-full min-w-0 rounded-[4px] bg-chrome px-2 text-[12px] text-text outline-none placeholder:text-faint"
        />
      )}
      {INSERT_TOOLS.map((group, i) => (
        <Group key={i}>
          {group.map(([id, icon]) => (
            <Fragment key={id}>
              <Tool
                label={BLOCK_ITEMS[id].label}
                pressed={
                  id === "table" || id === "rule"
                    ? undefined
                    : BLOCK_ITEMS[id].on(a)
                }
                disabled={readOnly || a.inTable}
                onRun={block(BLOCK_ITEMS[id])}
              >
                <Icon name={icon} />
              </Tool>
              {/* Beside the Table item: shown while the cursor is in one. */}
              {id === "table" && <TableControls />}
            </Fragment>
          ))}
        </Group>
      ))}
    </div>
  );
}
