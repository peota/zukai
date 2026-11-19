import type { Settings } from "./settings";
import type { MarkdownMode, TabState } from "./types";

/** The largest note the rich editor takes, in UTF-8 bytes. */
export const RICH_MAX_BYTES = 1_048_576;

export function tooLargeForRich(text: string): boolean {
  return new TextEncoder().encode(text).length > RICH_MAX_BYTES;
}

/**
 * The editor a Markdown Tab shows: null for any other Tab. The Settings
 * default only applies to a file or a Scratchpad whose language was picked;
 * a guessed Scratchpad stays Markdown source.
 */
export function effectiveMode(
  tab: TabState,
  settings: Settings,
): MarkdownMode | null {
  if (tab.kind !== "text" || tab.language !== "markdown") return null;
  if (tab.markdownMode) return tab.markdownMode;
  return tab.file || tab.languagePicked ? settings.markdownDefault : "markdown";
}
