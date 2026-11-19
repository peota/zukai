import type { ReactNode } from "react";
import { CANVAS_EXT, IMAGE_EXTS } from "../model/kinds";

/** The small line icons of the Library sidebar (spec 5.2): monochrome. */
export type IconName =
  | "folder"
  | "markdown"
  | "canvas"
  | "image"
  | "data"
  | "text"
  | "other"
  | "scratchpad"
  | "link"
  | "pin"
  // The rich editor's toolbar.
  | "paragraph"
  | "code"
  | "codeBlock"
  | "bulletList"
  | "numberedList"
  | "checklist"
  | "quote"
  | "table"
  | "rule";

const DATA_EXTS = [
  ".json",
  ".jsonc",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".xml",
  ".toml",
];
const TEXT_EXTS = [".txt", ".log", ".text"];

/** The icon for a file name, by extension (case-insensitive). */
export function fileIcon(name: string): IconName {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  const ext = name.slice(dot).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === CANVAS_EXT) return "canvas";
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (DATA_EXTS.includes(ext)) return "data";
  return TEXT_EXTS.includes(ext) ? "text" : "other";
}

const PATHS: Record<IconName, ReactNode> = {
  paragraph: (
    <path d="M8.5 2.5v9M10.5 2.5v9M11.5 2.5H6a2.5 2.5 0 0 0 0 5h2.5" />
  ),
  code: <path d="M5 3.5 1.8 7 5 10.5M9 3.5 12.2 7 9 10.5" />,
  codeBlock: (
    <>
      <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
      <path d="M5.5 5.5 4 7l1.5 1.5M8.5 5.5 10 7 8.5 8.5" />
    </>
  ),
  bulletList: (
    <>
      <circle cx="2.8" cy="3.5" r=".5" />
      <circle cx="2.8" cy="7" r=".5" />
      <circle cx="2.8" cy="10.5" r=".5" />
      <path d="M5.5 3.5h7M5.5 7h7M5.5 10.5h7" />
    </>
  ),
  numberedList: (
    <path d="M2.2 2.6l.9-.6v3M2 7.4c.2-.5.6-.8 1.1-.8.6 0 1 .4 1 .9 0 .8-2.1 1.6-2.1 2.3h2.2M5.8 3.5h6.7M5.8 7h6.7M5.8 10.5h6.7" />
  ),
  checklist: (
    <>
      <rect x="1.5" y="2" width="3.5" height="3.5" rx=".8" />
      <path d="m1.9 9.9 1 1 1.8-2.1M7 3.8h5.5M7 10h5.5" />
    </>
  ),
  quote: <path d="M2.5 2.5v9M5.5 4h7M5.5 7h7M5.5 10h4.5" />,
  table: (
    <>
      <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
      <path d="M1.5 5.5h11M1.5 8.8h11M5.2 5.5V12M8.8 5.5V12" />
    </>
  ),
  rule: <path d="M1.5 7h11M4 3.5h6M4 10.5h6" />,
  pin: <path d="M5 1.8h4M5.6 1.8v3.6L3.8 7.6h6.4L8.4 5.4V1.8M7 7.6v4.6" />,
  folder: (
    <path d="M1.5 4.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1H7L5.5 3h-3a1 1 0 0 0-1 1z" />
  ),
  markdown: (
    <>
      <rect x="1" y="3" width="12" height="8" rx="1.5" />
      <path d="M3.5 9V5.2l1.5 1.8 1.5-1.8V9M9.5 5v4M8.2 7.8 9.5 9l1.3-1.2" />
    </>
  ),
  canvas: (
    <>
      <path d="M7 1.8 12.2 7 7 12.2 1.8 7z" />
    </>
  ),
  image: (
    <>
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
      <circle cx="5" cy="5.6" r="1" />
      <path d="m2 10.5 3.2-3 2.3 2 1.8-1.5 3.2 2.6" />
    </>
  ),
  data: (
    <path d="M5 2.5c-1.5 0-1.5 1-1.5 2s-.2 2-1.5 2.5c1.3.5 1.5 1.5 1.5 2.5s0 2 1.5 2M9 2.5c1.5 0 1.5 1 1.5 2s.2 2 1.5 2.5c-1.3.5-1.5 1.5-1.5 2.5s0 2-1.5 2" />
  ),
  text: (
    <>
      <path d="M3.5 1.5h5l2.5 2.5v8.5h-7.5z" />
      <path d="M5.5 6.5h3M5.5 8.5h3M5.5 10.5h2" />
    </>
  ),
  other: <path d="M3.5 1.5h5l2.5 2.5v8.5h-7.5zM8.5 1.5V4H11" />,
  scratchpad: (
    <path d="M9.5 2.2l2.3 2.3-6.8 6.8-2.9.6.6-2.9zM8.3 3.4l2.3 2.3" />
  ),
  link: (
    <path d="M6 8a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 8 2.5l-.7.7M8 6a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 6 11.5l.7-.7" />
  ),
};

export function Icon({
  name,
  size = 14,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={"shrink-0 " + className}
    >
      {PATHS[name]}
    </svg>
  );
}

/** ▸ / ▾ for folders; rotates when open. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={"shrink-0 " + (open ? "rotate-90" : "")}
    >
      <path
        d="M3.5 2 7 5 3.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M5 1v8M1 5h8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** ⋯: a heading's menu. */
export function MoreIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="2.5" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="9.5" cy="6" r="1" fill="currentColor" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="5.2"
        cy="5.2"
        r="3.4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="m7.8 7.8 2.7 2.7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
