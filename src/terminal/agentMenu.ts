import { createElement } from "react";
import type { MenuItem } from "../ui/Menu";
import type { AgentInfo } from "./api";

/** The agents in the same order as Rust's `AGENTS`, for before the check. */
const AGENT_NAMES: ReadonlyArray<[id: string, name: string]> = [
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
  ["gemini", "Gemini"],
  ["opencode", "OpenCode"],
  ["cursor", "Cursor"],
];

const lead = (name: string) =>
  createElement(
    "span",
    {
      "aria-hidden": true,
      className:
        "flex h-4 w-4 items-center justify-center rounded-[4px] border border-hairline text-ui-xs leading-none text-faint",
    },
    name.charAt(0),
  );

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
    { label: "Terminal", hint: a.terminalHint, onSelect: a.onTerminal },
  ];
  if (agents === null) {
    AGENT_NAMES.forEach(([, name], n) =>
      items.push({
        label: name,
        hint: "checking…",
        disabled: true,
        lead: lead(name),
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
      lead: lead(g.name),
      onSelect: () => a.onAgent(g),
      ...(n === 0 && { separated: true, section: "Start an agent" }),
    }),
  );
  missing.forEach((g, n) =>
    items.push({
      label: g.name,
      hint: "not installed",
      disabled: true,
      lead: lead(g.name),
      ...(installed.length === 0 &&
        n === 0 && { separated: true, section: "Start an agent" }),
    }),
  );
  return items;
}
