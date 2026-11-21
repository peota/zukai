import { describe, expect, it } from "vitest";
import { providerLabel } from "./providerLabel";

describe("providerLabel", () => {
  it("names the provider and model", () => {
    expect(
      providerLabel({ provider: "anthropic", model: "claude-sonnet-5-5" }),
    ).toBe("Anthropic · claude-sonnet-5-5");
    expect(providerLabel({ provider: "openai", model: "gpt-5" })).toBe(
      "OpenAI · gpt-5",
    );
  });

  it("names Anthropic's default model when none is set", () => {
    expect(providerLabel({ provider: "anthropic", model: "" })).toBe(
      "Anthropic · claude-sonnet-5-5",
    );
  });

  it("names a compatible provider by its host", () => {
    expect(
      providerLabel({
        provider: "compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3",
      }),
    ).toBe("localhost:11434 · llama3");
  });

  it("falls back to the URL as written, or AI provider", () => {
    expect(
      providerLabel({
        provider: "compatible",
        baseUrl: "not a url",
        model: "m",
      }),
    ).toBe("not a url · m");
    expect(providerLabel({ provider: "compatible", model: "m" })).toBe(
      "AI provider · m",
    );
    expect(providerLabel(null)).toBe("AI provider");
  });
});
