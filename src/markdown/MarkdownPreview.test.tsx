import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTextFeed,
  MarkdownPreview,
  PREVIEW_DEBOUNCE_MS,
} from "./MarkdownPreview";

afterEach(() => vi.useRealTimers());

function setup(
  text = "# Title\n\n[site](https://zukai.app) [down](#later)\n\n## Later",
) {
  const feed = createTextFeed();
  const onOpenLink = vi.fn();
  const loadContent = vi.fn(async () => text);
  const r = render(
    <MarkdownPreview
      id="a"
      loadContent={loadContent}
      feed={feed}
      onOpenLink={onOpenLink}
    />,
  );
  const preview = () =>
    screen.getByRole("article", { name: "Markdown preview" });
  return { ...r, feed, onOpenLink, loadContent, preview };
}

describe("MarkdownPreview", () => {
  it("renders the Tab's text", async () => {
    const { preview, loadContent } = setup();
    await waitFor(() =>
      expect(preview().querySelector("h1")?.textContent).toBe("Title"),
    );
    expect(loadContent).toHaveBeenCalledWith("a");
  });

  it("follows edits, a little after the last keystroke", async () => {
    const { preview, feed } = setup("old");
    await waitFor(() => expect(preview()).toHaveTextContent("old"));
    vi.useFakeTimers();
    act(() => {
      feed.publish("a", "# new");
      feed.publish("b", "# other tab");
    });
    expect(preview()).toHaveTextContent("old");
    await act(async () => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(preview().querySelector("h1")?.textContent).toBe("new"),
    );
  });

  it("opens web links outside the app and jumps to headings", async () => {
    const { preview, onOpenLink } = setup();
    await waitFor(() => expect(preview().querySelector("a")).not.toBeNull());
    const later = preview().querySelector("#later")!;
    later.scrollIntoView = vi.fn();
    const site = screen.getByRole("link", { name: "site" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    site.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith("https://zukai.app");
    fireEvent.click(screen.getByRole("link", { name: "down" }));
    expect(later.scrollIntoView).toHaveBeenCalled();
    expect(onOpenLink).toHaveBeenCalledTimes(1);
  });

  it("does nothing for other links, and never navigates", async () => {
    const { preview, onOpenLink } = setup("[f](C:/notes/a.md)");
    await waitFor(() => expect(preview().querySelector("a")).not.toBeNull());
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    preview().querySelector("a")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("stops listening when closed", async () => {
    const { feed, unmount, preview } = setup("x");
    await waitFor(() => expect(preview()).toHaveTextContent("x"));
    unmount();
    expect(() => feed.publish("a", "y")).not.toThrow();
  });
});
