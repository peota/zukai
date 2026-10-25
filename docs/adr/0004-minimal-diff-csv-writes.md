# 4. Minimal-diff CSV writes

Date: 2026-10-25
Status: Accepted

## Context

Files autosave to disk (ADR 0001), so the first cell edit in a Table writes the CSV right away. The usual approach is to parse the file into rows and write them all back out with a standard CSV library. That silently changes things the user never touched: the delimiter, quoting, line endings (CRLF vs LF), the encoding and BOM, and the newline at the end of the file. A one-cell edit would show up as a change to the whole file in git and in other tools.

## Decision

A Table writes back the smallest possible change:
- The file keeps its original delimiter, line endings, encoding and BOM, and ending newline (or lack of one).
- Rows that weren't edited are written back byte for byte from their original text.
- An edited cell keeps its quotes if it was quoted before. Otherwise it is quoted only if it now contains the delimiter, a quote mark or a line break.

## Consequences

- A one-cell edit produces a one-line diff.
- The parser has to keep each row's original text alongside its parsed values, so a standard CSV library can't be used as-is. This is extra work, but it's contained in one module.
- Adding or deleting rows writes new rows in the file's existing style.
