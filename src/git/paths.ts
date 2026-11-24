/** Joins a folder and a `/`-separated relative path with the folder's own separator. */
export function joinRel(folder: string, rel: string): string {
  const sep = folder.includes("\\") ? "\\" : "/";
  const base = folder.endsWith(sep) ? folder.slice(0, -1) : folder;
  return base + sep + rel.split("/").join(sep);
}
