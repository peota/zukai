import { useEffect } from "react";
import { Menu, type MenuProps } from "../ui/Menu";
import { agentMenuItems } from "./agentMenu";
import type { AgentInfo } from "./api";

export interface NewTerminalMenuProps extends Pick<
  MenuProps,
  "x" | "y" | "side" | "align" | "onDismiss"
> {
  /** The last check's result; `null` before the first. */
  agents: AgentInfo[] | null;
  /** Checks the agents again; called each time the menu opens. */
  refresh(): void;
  /** The Terminal item's shortcut. */
  terminalHint: string;
  onTerminal(): void;
  onAgent(agent: AgentInfo): void;
}

/**
 * The New terminal menu: a plain Terminal, then the agents to start. It
 * mounts only while open, so each opening checks the agents afresh while it
 * draws from the last result.
 */
export function NewTerminalMenu({
  agents,
  refresh,
  terminalHint,
  onTerminal,
  onAgent,
  ...menu
}: NewTerminalMenuProps) {
  useEffect(() => refresh(), [refresh]);
  return (
    <Menu
      {...menu}
      label="New terminal"
      ignoreSelector="[data-z-agent-menu]"
      items={agentMenuItems(agents, { terminalHint, onTerminal, onAgent })}
    />
  );
}
