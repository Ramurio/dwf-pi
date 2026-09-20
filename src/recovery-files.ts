import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, readdir, readlink, realpath, open, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface FileObservation { path: string; kind: "directory" | "file" | "symlink" | "missing" | "special"; mode?: number; size?: number; digest?: string; target?: string }
export interface WorkspaceObservation { digest: string; roots: string[]; excluded: string[]; entries: number; bytes: number; links: string[]; special: string[] }
export const recoveryDigest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function filesystemText(bytes: Buffer, path: string): string {
  try { return utf8.decode(bytes); }
  catch { throw new Error(`Recovery inspection requires UTF-8 filesystem names and symlink targets: ${path}`); }
}
async function directoryNames(path: string): Promise<string[]> {
  return (await readdir(path, { encoding: "buffer" })).map(bytes => filesystemText(bytes, path));
}
const within = (path: string, root: string) => path === root || path.startsWith(root + sep);
async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path); if (parent === path) return path;
    return join(await canonicalPath(parent), basename(path));
  }
}

/** Hashes bytes without following leaf symlinks or opening sockets/FIFOs. */
export async function observeRecoveryFiles(paths: readonly string[], exclusions: readonly string[] = []): Promise<WorkspaceObservation> {
  const roots = [...new Set(await Promise.all(paths.map(path => canonicalPath(resolve(path)))))].sort();
  // An excluded directory replaced by a symlink must not hide its unrelated target.
  const excluded = [...new Set(await Promise.all(exclusions.map(async path => {
    const absolute = resolve(path); return join(await canonicalPath(dirname(absolute)), basename(absolute));
  })))].sort();
  const rows: FileObservation[] = [];
  const seen = new Set<string>();
  const skip = (path: string, root: string) => excluded.some(exclusion => !within(root, exclusion) && within(path, exclusion));
  const visit = async (path: string, root: string): Promise<void> => {
    if (skip(path, root) || seen.has(path)) return;
    seen.add(path);
    let before;
    try { before = await lstat(path, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; rows.push({ path, kind: "missing" }); return; }
    const mode = Number(before.mode);
    if (before.isSymbolicLink()) {
      rows.push({ path, kind: "symlink", mode, target: filesystemText(await readlink(path, { encoding: "buffer" }), path) });
    } else if (before.isDirectory()) {
      const names = (await directoryNames(path)).filter(name => !skip(join(path, name), root)).sort(); rows.push({ path, kind: "directory", mode });
      for (const name of names) await visit(join(path, name), root);
      const afterNames = (await directoryNames(path)).filter(name => !skip(join(path, name), root)).sort();
      if (JSON.stringify(names) !== JSON.stringify(afterNames)) throw new Error(`Directory changed during recovery inspection: ${path}`);
    } else if (before.isFile()) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`File replaced during recovery inspection: ${path}`);
        const hash = createHash("sha256");
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat({ bigint: true });
        if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error(`File changed during recovery inspection: ${path}`);
        rows.push({ path, kind: "file", mode, size: Number(before.size), digest: hash.digest("hex") });
      } finally { await handle.close(); }
    } else rows.push({ path, kind: "special", mode });
    const after = await lstat(path, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode || (!before.isDirectory() && (after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs))) throw new Error(`Path changed during recovery inspection: ${path}`);
  };
  for (const root of roots) await visit(root, root);
  return { digest: recoveryDigest({ roots, excluded, rows }), roots, excluded, entries: rows.length,
    bytes: rows.reduce((total, row) => total + (row.size ?? 0), 0), links: rows.filter(row => row.kind === "symlink").map(row => row.path), special: rows.filter(row => row.kind === "special").map(row => row.path) };
}

/** Linked worktrees keep HEAD/index/config outside the worktree directory. */
export async function recoveryGitDirectories(root: string): Promise<string[]> {
  let current = await canonicalPath(resolve(root));
  try { if (!(await lstat(current)).isDirectory()) current = dirname(current); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (;;) {
    const marker = join(current, ".git");
    let info;
    try { info = await lstat(marker); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (info) {
      if (info.isDirectory()) return [await realpath(marker)];
      if (info.isFile()) {
        const match = /^gitdir: ([^\r\n]+)$/.exec((await readFile(marker, "utf8")).replace(/\r?\n$/, ""));
        if (!match) throw new Error(`Invalid Git directory marker: ${marker}`);
        const git = await realpath(resolve(current, match[1]!));
        let common: string;
        try { common = (await readFile(join(git, "commondir"), "utf8")).replace(/\r?\n$/, ""); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return [git]; }
        if (!common || /[\r\n]/.test(common)) throw new Error("Invalid Git common directory marker");
        return [...new Set([git, await realpath(isAbsolute(common) ? common : resolve(git, common))])];
      }
      throw new Error(`Unsupported Git directory marker: ${marker}`);
    }
    const parent = dirname(current); if (parent === current) return []; current = parent;
  }
}
