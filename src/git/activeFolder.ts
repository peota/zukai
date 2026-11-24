import { isUnder } from "../ui/libraryEntries";

/**
 * The library folder the active Tab belongs to: a diff Tab's own folder, else
 * the most specific (longest) library folder holding the active File. Null
 * for a Scratchpad or a File outside every folder.
 */
export function activeGitFolder(i: {
  diffFolder?: string;
  activeFile?: string;
  folders: string[];
}): string | null {
  if (i.diffFolder !== undefined) return i.diffFolder;
  const file = i.activeFile;
  if (file === undefined) return null;
  return (
    i.folders
      .filter((f) => isUnder(file, f))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}
