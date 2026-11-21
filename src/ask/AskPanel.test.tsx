import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskPanel } from "./AskPanel";
import type { Conversation } from "./conversation";
import type { UseAsk } from "./useAsk";

function fakeAsk(
  conversation: Conversation = { turns: [], streaming: null },
  result: ReturnType<UseAsk["send"]> = "sent",
): UseAsk {
  return {
    conversation,
    send: vi.fn(() => result),
    stop: vi.fn(),
    clear: vi.fn(),
  };
}

function setup(
  ask: UseAsk = fakeAsk(),
  scopeLabel: string | null = "This note · a.md",
) {
  const props = {
    ask,
    scopeLabel,
    providerLabel: "Anthropic · claude-sonnet-5-5",
    width: 400,
    onWidth: vi.fn(),
    onClose: vi.fn(),
    onOpenUrl: vi.fn(),
    onFocusEditor: vi.fn(),
  };
  const r = render(<AskPanel {...props} />);
  const input = screen.getByRole("textbox", { name: "Question" });
  return { ...r, props, input };
}

const answered = (text: string): Conversation => ({
  turns: [
    { role: "user", text: "what is this?", noteTitle: "a.md" },
    { role: "assistant", text },
  ],
  streaming: null,
});

describe("AskPanel", () => {
  it("is a region named Ask with the note's scope", () => {
    setup();
    expect(screen.getByRole("region", { name: "Ask" })).toBeTruthy();
    expect(screen.getByText("This note · a.md")).toBeTruthy();
  });

  it("shows No note without a note", () => {
    setup(fakeAsk(), null);
    expect(screen.getByText("No note")).toBeTruthy();
  });

  it("Enter sends the question and clears the input", () => {
    const ask = fakeAsk();
    const { input } = setup(ask);
    fireEvent.change(input, { target: { value: "summarise this" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ask.send).toHaveBeenCalledWith("summarise this");
    expect(input).toHaveValue("");
  });

  it("Shift+Enter doesn't send", () => {
    const ask = fakeAsk();
    const { input } = setup(ask);
    fireEvent.change(input, { target: { value: "one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(ask.send).not.toHaveBeenCalled();
    expect(input).toHaveValue("one");
  });

  it("doesn't send an empty question", () => {
    const ask = fakeAsk();
    const { input } = setup(ask);
    fireEvent.change(input, { target: { value: "  \n " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ask.send).not.toHaveBeenCalled();
  });

  it("a noNote result explains and keeps the question", () => {
    const { input } = setup(fakeAsk(undefined, "noNote"));
    fireEvent.change(input, { target: { value: "why?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Ask works on text notes for now.")).toBeTruthy();
    expect(input).toHaveValue("why?");
  });

  it("a tooLong result explains", () => {
    const { input } = setup(fakeAsk(undefined, "tooLong"));
    fireEvent.change(input, { target: { value: "why?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      screen.getByText("This note is too long to ask about."),
    ).toBeTruthy();
  });

  it("while streaming, Stop stops and the provider shows", () => {
    const ask = fakeAsk({
      turns: [
        { role: "user", text: "q", noteTitle: "a.md" },
        { role: "assistant", text: "" },
      ],
      streaming: 3,
    });
    setup(ask);
    expect(
      screen.getByText("Asking Anthropic · claude-sonnet-5-5…"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(ask.stop).toHaveBeenCalled();
  });

  it("not streaming, there's no Stop", () => {
    setup(fakeAsk(answered("done")));
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByText(/^Asking /)).toBeNull();
  });

  it("renders an answer's Markdown", () => {
    const { container } = setup(fakeAsk(answered("a **bold** word")));
    expect(screen.getByText("what is this?")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders no script from an answer", () => {
    const { container } = setup(
      fakeAsk(answered('hi <script>alert("x")</script>')),
    );
    expect(container.querySelector("script")).toBeNull();
  });

  it("a web link opens outside the app", () => {
    const { props } = setup(
      fakeAsk(answered("see [docs](https://example.com/x)")),
    );
    const link = screen.getByRole("link", { name: "docs" });
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(props.onOpenUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("shows an answer's error", () => {
    setup(
      fakeAsk({
        turns: [
          { role: "user", text: "q", noteTitle: "a.md" },
          { role: "assistant", text: "", error: "The key was refused" },
        ],
        streaming: null,
      }),
    );
    expect(screen.getByText("The key was refused")).toBeTruthy();
  });

  it("New conversation clears; × closes", () => {
    const ask = fakeAsk(answered("x"));
    const { props } = setup(ask);
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(ask.clear).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close Ask panel" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("Esc gives the keyboard back to the editor", () => {
    const { input, props } = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onFocusEditor).toHaveBeenCalled();
  });

  it("takes the keyboard when it opens", () => {
    const { input } = setup();
    expect(input).toHaveFocus();
  });

  it("the left edge resizes it", () => {
    const { props } = setup();
    const edge = screen.getByRole("separator", { name: "Resize Ask panel" });
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(props.onWidth).toHaveBeenCalledWith(expect.any(Number));
    expect(props.onWidth.mock.calls[0][0]).toBeGreaterThan(400);
  });
});
