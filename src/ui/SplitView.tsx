import type { ReactNode } from "react";
import type { SplitOrientation } from "../model/types";
import { SplitHandle } from "../markdown/SplitHandle";

export interface SplitViewProps {
  /** "row": side by side; "column": top and bottom. */
  orientation: SplitOrientation;
  /** The first half's share (0.2–0.8). */
  ratio: number;
  onRatio(r: number): void;
  focus: "a" | "b";
  first: ReactNode;
  second: ReactNode;
}

function Half({
  focused,
  basis,
  children,
}: {
  focused: boolean;
  basis?: number;
  children: ReactNode;
}) {
  return (
    <div
      data-focused={focused ? "" : undefined}
      className={`relative min-h-0 min-w-0 ${basis === undefined ? "flex-1" : "shrink-0"}`}
      style={basis === undefined ? undefined : { flexBasis: `${basis * 100}%` }}
    >
      {children}
      {focused && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-accent" />
      )}
    </div>
  );
}

/** A Split's two Tabs and the divider between them. */
export function SplitView({
  orientation,
  ratio,
  onRatio,
  focus,
  first,
  second,
}: SplitViewProps) {
  return (
    <div
      data-split-view=""
      className={`flex size-full ${orientation === "row" ? "flex-row" : "flex-col"}`}
    >
      <Half focused={focus === "a"} basis={ratio}>
        {first}
      </Half>
      <SplitHandle
        ratio={ratio}
        onRatio={onRatio}
        orientation={orientation}
        label="Resize split"
      />
      <Half focused={focus === "b"}>{second}</Half>
    </div>
  );
}
