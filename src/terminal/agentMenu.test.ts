import { describe, expect, it, vi } from "vitest";
import { createElement, Fragment } from "react";
import { render } from "@testing-library/react";
import { agentMenuItems } from "./agentMenu";
import type { AgentInfo } from "./api";

const handlers = () => ({
  terminalHint: "Ctrl+`",
  onTerminal: vi.fn(),
  onAgent: vi.fn(),
});

const list: AgentInfo[] = [
  { id: "claude-code", name: "Claude Code", installed: false },
  { id: "codex", name: "Codex", installed: true },
  { id: "gemini", name: "Gemini", installed: false },
  { id: "opencode", name: "OpenCode", installed: true },
  { id: "cursor", name: "Cursor", installed: false },
];

describe("agentMenuItems", () => {
  it("lists Terminal, installed agents numbered, then the rest disabled", () => {
    const items = agentMenuItems(list, handlers());
    expect(items.map((i) => i.label)).toEqual([
      "Terminal",
      "Codex",
      "OpenCode",
      "Claude Code",
      "Gemini",
      "Cursor",
    ]);
    expect(items.map((i) => i.accel)).toEqual([
      undefined,
      "1",
      "2",
      undefined,
      undefined,
      undefined,
    ]);
    expect(items[0].hint).toBe("Ctrl+`");
    expect(items[1].separated).toBe(true);
    expect(items[1].section).toBe("Start an agent");
    for (const i of items.slice(3)) {
      expect(i.disabled).toBe(true);
      expect(i.hint).toBe("not installed");
    }
  });

  it("runs the handlers", () => {
    const h = handlers();
    const items = agentMenuItems(list, h);
    items[0].onSelect?.();
    items[1].onSelect?.();
    expect(h.onTerminal).toHaveBeenCalled();
    expect(h.onAgent).toHaveBeenCalledWith(list[1]);
  });

  it("shows all five disabled as checking while unknown", () => {
    const items = agentMenuItems(null, handlers());
    expect(items.slice(1).map((i) => i.label)).toEqual([
      "Claude Code",
      "Codex",
      "Gemini",
      "OpenCode",
      "Cursor",
    ]);
    for (const i of items.slice(1)) {
      expect(i.disabled).toBe(true);
      expect(i.hint).toBe("checking…");
    }
  });

  it("shows each agent's logo, a letter for Codex, and a terminal icon", () => {
    const items = agentMenuItems(list, handlers());
    const { container } = render(
      createElement(Fragment, null, ...items.map((i) => i.lead)),
    );
    const marks = [...container.querySelectorAll("[data-agent-logo]")];
    expect(
      marks.map((m) => [m.getAttribute("data-agent-logo"), m.tagName]),
    ).toEqual([
      ["codex", "SPAN"],
      ["opencode", "svg"],
      ["claude-code", "svg"],
      ["gemini", "svg"],
      ["cursor", "svg"],
    ]);
    // Not installed: dimmed with its row.
    expect(marks[2].getAttribute("class")).toContain("opacity-45");
    expect(marks[1].getAttribute("class")).not.toContain("opacity-45");
    expect(container.querySelector('[data-icon="shell"]')).not.toBeNull();
  });
});
