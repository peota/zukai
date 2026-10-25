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

  it("needs statement structure before guessing SQL", () => {
    for (const sql of [
      "SELECT id FROM t",
      "select * from users u where u.id = 1",
      "SELECT name\nFROM people\nORDER BY name",
      "select 1;",
      "SELECT a.x, b.y\nFROM a\nJOIN b ON a.id = b.id",
      "insert into t (a, b) values (1, 2)",
      "update t set a = 1 where id = 2",
      "delete from t where id = 1",
      "create table t (id int primary key)",
      "drop table t;",
    ]) {
      expect(guessLanguage(sql), sql).toBe("sql");
    }
  });

  it("does not take prose for SQL", () => {
    for (const prose of [
      "Select a hotel from the list",
      "Select a hotel from the list and book it",
      "Select a hotel from the list where breakfast is free",
      "select the best option from your choices",
      "Select one from each group\n\nfrom t where x",
      "Delete from the archive anything older than a week",
      "Update the docs set up guide",
      "Create table of contents for the report",
      "Drop table tennis practice",
      "Insert into the binder after page two",
    ]) {
      expect(guessLanguage(prose), prose).toBeNull();
    }
  });

  it("needs a second Markdown signal after a leading heading", () => {
    for (const md of [
      "# Title\n\nSome text",
      "# Title\n- one\n- two",
      "# Title\nSee [the docs](https://example.com)",
      "# A\n\n## B",
      "# Notes\nThis is **important**",
    ]) {
      expect(guessLanguage(md), md).toBe("markdown");
    }
  });

  it("does not take comment-led config or scripts for Markdown", () => {
    for (const text of [
      "# only a heading",
      "# comment\nkey: value\nother: 2",
      "# config\nitems:\n  - a\n  - b",
      "# install\nnpm install\n\n# build\nnpm run build",
      "# settings\nport=8080\nhost=localhost",
      "# run it\n\necho hello world",
      "# Comment\n\nexport PATH=$HOME/bin:$PATH",
    ]) {
      expect(guessLanguage(text), text).toBeNull();
    }
  });

  // Boundedness is proven by the prefix tests; these bounds only catch
  // pathological slowness and must not flake on a busy CI machine.
  it("guessLooksAtPrefixOnly", () => {
    const huge = "{" + "x".repeat(5_000_000);
    const start = performance.now();
    guessLanguage(huge);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("stays cheap on a large markup or prose prefix", () => {
    for (const big of [
      "<r>" + "<a>x</b>".repeat(20_000),
      "word ".repeat(1_000_000),
      "\n".repeat(1_000_000) + "x",
    ]) {
      const start = performance.now();
      guessLanguage(big);
      expect(performance.now() - start).toBeLessThan(200);
    }
  });
});
