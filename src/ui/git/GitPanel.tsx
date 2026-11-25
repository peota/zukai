import { GIT_MIN_WIDTH } from "../../model/settings";
import { CloseIcon } from "../icons";
import { PanelResizeEdge } from "../PanelResizeEdge";
import { GitView, type GitViewProps } from "./GitView";

export interface GitPanelProps extends GitViewProps {
  /** The panel's width in px. */
  width: number;
  onWidth(px: number): void;
  onClose(): void;
}

/**
 * The Git panel: a slim header (Git and ×) over the Git view. It docks on
 * the right of the editor area and takes turns with the Ask panel.
 */
export function GitPanel({ width, onWidth, onClose, ...view }: GitPanelProps) {
  return (
    <section
      aria-label="Git panel"
      data-z-right-panel=""
      data-z-git-panel=""
      className="relative flex min-h-0 min-w-0 shrink-0 flex-row bg-side"
      style={{ width, minWidth: GIT_MIN_WIDTH, maxWidth: "70%" }}
    >
      <PanelResizeEdge
        label="Resize Git panel"
        width={width}
        min={GIT_MIN_WIDTH}
        onWidth={onWidth}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hairline bg-chrome pr-1.5 pl-3 text-ui-sm select-none">
          <span className="shrink-0 font-semibold text-text">Git</span>
          <button
            type="button"
            aria-label="Close Git panel"
            title="Close"
            onClick={onClose}
            className="ml-auto flex size-6 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
          >
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-2 pt-2 text-ui-lg select-none">
          <GitView {...view} />
        </div>
      </div>
    </section>
  );
}
