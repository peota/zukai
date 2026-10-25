import { describe, expect, it } from "vitest";
import { guessLanguage } from "./guess";

describe("guessLanguage", () => {
  it("guesses JSON only when the text is valid JSON", () => {
    expect(guessLanguage('{"a":1}')).toBe("json");
    expect(guessLanguage("[1,2]")).toBe("json");
    expect(guessLanguage("{")).toBeNull();
  });

  it("tells XML from HTML", () => {
    expect(guessLanguage('<?xml version="1.0"?><a/>')).toBe("xml");
    expect(guessLanguage("<!DOCTYPE html><html>")).toBe("html");
    expect(guessLanguage("<root><x></x></root>")).toBe("xml");
  });

  it("guesses SQL from a leading statement keyword", () => {
    expect(guessLanguage("SELECT id FROM t")).toBe("sql");
    expect(guessLanguage("  with x as (select 1)")).toBe("sql");
  });

  it("guesses shell and Python", () => {
    expect(guessLanguage("#!/bin/bash\necho hi")).toBe("shell");
    expect(guessLanguage("#!/usr/bin/env python3")).toBe("python");
    expect(guessLanguage("import os\ndef f():")).toBe("python");
  });

  it("guesses Markdown", () => {
    expect(guessLanguage("# Title\n\nSome text")).toBe("markdown");
    expect(guessLanguage("Some notes\n```js\nlet a = 1\n```")).toBe("markdown");
  });

  it("stays plain text when unsure", () => {
    expect(guessLanguage("hello world")).toBeNull();
    expect(guessLanguage("")).toBeNull();
    expect(guessLanguage("a: b")).toBeNull();
  });

  it("guessLooksAtPrefixOnly", () => {
    const huge = "{" + "x".repeat(5_000_000);
    const start = performance.now();
    guessLanguage(huge);
    expect(performance.now() - start).toBeLessThan(20);
  });

  it("stays cheap on a large markup or prose prefix", () => {
    for (const big of [
      "<r>" + "<a>x</b>".repeat(20_000),
      "word ".repeat(1_000_000),
      "\n".repeat(1_000_000) + "x",
    ]) {
      const start = performance.now();
      guessLanguage(big);
      expect(performance.now() - start).toBeLessThan(20);
    }
  });
});
