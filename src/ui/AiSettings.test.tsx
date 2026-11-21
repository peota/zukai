import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiStatus } from "../ask/api";
import { AiSettings } from "./AiSettings";

vi.mock("../ask/api", () => ({
  aiConfigSet: vi.fn(),
  aiKeySet: vi.fn(),
  aiKeyRemove: vi.fn(),
}));
import { aiConfigSet, aiKeyRemove, aiKeySet } from "../ask/api";

const none: AiStatus = { config: null, hasKey: false, ready: false };
const anthropic: AiStatus = {
  config: { provider: "anthropic", model: "claude-sonnet-5-5" },
  hasKey: true,
  ready: true,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AiSettings", () => {
  it("shows the URL field only for OpenAI-compatible", async () => {
    render(<AiSettings status={none} onStatus={vi.fn()} />);
    expect(screen.queryByLabelText("URL")).toBeNull();
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "compatible" },
    });
    expect(screen.getByLabelText("URL")).toHaveAttribute(
      "placeholder",
      "http://localhost:11434/v1",
    );
  });

  it("saves a typed key, then clears the field", async () => {
    const onStatus = vi.fn();
    vi.mocked(aiKeySet).mockResolvedValue(anthropic);
    render(
      <AiSettings
        status={{ ...anthropic, hasKey: false, ready: false }}
        onStatus={onStatus}
      />,
    );
    const field = screen.getByLabelText("Key");
    fireEvent.change(field, { target: { value: "sk-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(aiKeySet).toHaveBeenCalledWith("sk-secret");
    await waitFor(() => expect(field).toHaveValue(""));
    expect(onStatus).toHaveBeenCalledWith(anthropic);
  });

  it("never renders a stored key; Remove forgets it", async () => {
    const onStatus = vi.fn();
    vi.mocked(aiKeyRemove).mockResolvedValue({
      ...anthropic,
      hasKey: false,
      ready: false,
    });
    const { container } = render(
      <AiSettings status={anthropic} onStatus={onStatus} />,
    );
    expect(screen.getByText("Key set")).toBeInTheDocument();
    expect(screen.queryByLabelText("Key")).toBeNull();
    expect(container.querySelector("input[type=password]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(aiKeyRemove).toHaveBeenCalled();
    await waitFor(() => expect(onStatus).toHaveBeenCalled());
  });

  it("warns before a provider change forgets the key; Cancel keeps it", async () => {
    render(<AiSettings status={anthropic} onStatus={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    expect(
      screen.getByText("Changing the provider forgets the saved key."),
    ).toBeInTheDocument();
    expect(aiConfigSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(aiConfigSet).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Provider")).toHaveValue("anthropic");
  });

  it("applies the provider change on confirm", async () => {
    const next: AiStatus = {
      config: { provider: "openai", model: "" },
      hasKey: false,
      ready: false,
    };
    vi.mocked(aiConfigSet).mockResolvedValue(next);
    const onStatus = vi.fn();
    render(<AiSettings status={anthropic} onStatus={onStatus} />);
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
    expect(aiConfigSet).toHaveBeenCalledWith({
      provider: "openai",
      model: "",
    });
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(next));
  });

  it("shows a command error under the row", async () => {
    vi.mocked(aiKeySet).mockRejectedValue({
      kind: "keychain",
      message: "Keychain is locked",
    });
    render(
      <AiSettings
        status={{ ...none, config: anthropic.config }}
        onStatus={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByText("Keychain is locked")).toBeInTheDocument();
  });

  it("warns before a URL change forgets the key; Cancel restores the URL", () => {
    const status: AiStatus = {
      config: {
        provider: "compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "llama",
      },
      hasKey: true,
      ready: true,
    };
    render(<AiSettings status={status} onStatus={vi.fn()} />);
    const url = screen.getByLabelText("URL");
    fireEvent.change(url, { target: { value: "http://other/v1" } });
    fireEvent.blur(url);
    expect(
      screen.getByText("Changing the URL forgets the saved key."),
    ).toBeInTheDocument();
    expect(aiConfigSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(aiConfigSet).not.toHaveBeenCalled();
    expect(screen.getByLabelText("URL")).toHaveValue(
      "http://localhost:11434/v1",
    );
  });

  it("goes back to the stored provider when saving fails", async () => {
    vi.mocked(aiConfigSet).mockRejectedValue({
      kind: "io",
      message: "Could not write ai.json",
    });
    render(
      <AiSettings
        status={{ ...anthropic, hasKey: false, ready: false }}
        onStatus={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    expect(await screen.findByText("Could not write ai.json")).toBeVisible();
    expect(screen.getByLabelText("Provider")).toHaveValue("anthropic");
  });

  it("follows the stored config when it changes", () => {
    const { rerender } = render(
      <AiSettings status={anthropic} onStatus={vi.fn()} />,
    );
    rerender(
      <AiSettings
        status={{
          config: { provider: "openai", model: "gpt-x" },
          hasKey: true,
          ready: true,
        }}
        onStatus={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Provider")).toHaveValue("openai");
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-x");
  });

  it("does not send an unconfirmed URL when the Model field is left", () => {
    render(
      <AiSettings
        status={{
          config: {
            provider: "compatible",
            baseUrl: "http://localhost:11434/v1",
            model: "llama",
          },
          hasKey: true,
          ready: true,
        }}
        onStatus={vi.fn()}
      />,
    );
    const url = screen.getByLabelText("URL");
    fireEvent.change(url, { target: { value: "http://other/v1" } });
    fireEvent.blur(url);
    const model = screen.getByLabelText("Model");
    fireEvent.focus(model);
    fireEvent.blur(model);
    fireEvent.keyDown(model, { key: "Enter" });
    expect(aiConfigSet).not.toHaveBeenCalled();
    expect(
      screen.getByText("Changing the URL forgets the saved key."),
    ).toBeInTheDocument();
  });

  it("keeps typed text when an equal status arrives", () => {
    const cfg = { provider: "anthropic" as const, model: "claude-sonnet-5-5" };
    const { rerender } = render(
      <AiSettings
        status={{ config: cfg, hasKey: false, ready: false }}
        onStatus={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "half-typed" },
    });
    rerender(
      <AiSettings
        status={{ config: { ...cfg }, hasKey: true, ready: true }}
        onStatus={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Model")).toHaveValue("half-typed");
  });
});
