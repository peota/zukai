import { createElement } from "react";
import { Icon } from "../ui/icons";
import type { MenuItem } from "../ui/Menu";
import { AgentLogo } from "./agentLogos";
import type { AgentInfo } from "./api";

/** The agents in the same order as Rust's `AGENTS`, for before the check. */
const AGENT_NAMES: ReadonlyArray<[id: string, name: string]> = [
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
  ["gemini", "Gemini"],
  ["opencode", "OpenCode"],
  ["cursor", "Cursor"],
];

const lead = (id: string, name: string, dim: boolean) =>
  createElement(AgentLogo, { id, name, dim });

/** The "new Terminal" menu: a plain Terminal, then the agents to start. */
export function agentMenuItems(
  agents: AgentInfo[] | null,
  a: {
    terminalHint: string;
    onTerminal(): void;
    onAgent(agent: AgentInfo): void;
  },
): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: "Terminal",
      hint: a.terminalHint,
      lead: createElement(Icon, { name: "shell", className: "text-faint" }),
      onSelect: a.onTerminal,
    },
  ];
  if (agents === null) {
    AGENT_NAMES.forEach(([id, name], n) =>
      items.push({
        label: name,
        hint: "checking…",
        disabled: true,
        lead: lead(id, name, true),
        ...(n === 0 && { separated: true, section: "Start an agent" }),
      }),
    );
    return items;
  }
  const installed = agents.filter((g) => g.installed);
  const missing = agents.filter((g) => !g.installed);
  installed.forEach((g, n) =>
    items.push({
      label: g.name,
      hint: n < 9 ? String(n + 1) : undefined,
      accel: n < 9 ? String(n + 1) : undefined,
      lead: lead(g.id, g.name, false),
      onSelect: () => a.onAgent(g),
      ...(n === 0 && { separated: true, section: "Start an agent" }),
    }),
  );
  missing.forEach((g, n) =>
    items.push({
      label: g.name,
      hint: "not installed",
      disabled: true,
      lead: lead(g.id, g.name, true),
      ...(installed.length === 0 &&
        n === 0 && { separated: true, section: "Start an agent" }),
    }),
  );
  return items;
}
