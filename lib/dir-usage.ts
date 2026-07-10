import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Total size of a directory's .mp4 files — the number the Library's
 *  "Clear All" dialog shows before deleting. Missing dir = empty, not an
 *  error. Server-side only (used by /api/clips and /api/grab). */
export async function dirUsage(dir: string): Promise<{ files: number; bytes: number }> {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".mp4"));
    let bytes = 0;
    for (const n of names) bytes += (await stat(path.join(dir, n))).size;
    return { files: names.length, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}
