import { access, lstat, mkdir, readlink, rename, symlink, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

export interface SetupOptions { binDir?: string; skillsDir?: string; replace?: boolean }
interface LinkPlan { path: string; target: string; action: "create" | "unchanged" | "replace" }
export interface SetupResult { root: string; executable: string; skill: string; links: LinkPlan[]; binOnPath: boolean }
const root = fileURLToPath(new URL("../", import.meta.url));
async function planLink(path: string, target: string, replace: boolean): Promise<LinkPlan> {
  try {
    const current = await lstat(path);
    if (!current.isSymbolicLink()) throw new Error(`Refusing to replace an existing file or directory: ${path}`);
    const linked = resolve(dirname(path), await readlink(path));
    if (linked === target) return { path, target, action: "unchanged" };
    if (!replace) throw new Error(`Existing symlink points elsewhere: ${path}; use --replace to replace this symlink`);
    return { path, target, action: "replace" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, target, action: "create" };
    throw error;
  }
}
/** Explicit destinations make setup testable without changing the real user's installation. */
export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) throw new Error("dynamicwf requires Node.js 22.19 or newer");
  const executable = resolve(root, "bin", "dynamicwf.mjs");
  const skill = resolve(root, "skills", "dynamic-workflows");
  await access(executable, constants.R_OK | constants.X_OK);
  await access(join(skill, "SKILL.md"), constants.R_OK);
  await access(resolve(root, "node_modules", "tsx", "package.json"), constants.R_OK);
  const binDir = resolve(options.binDir ?? join(homedir(), ".local", "bin"));
  const skillsDir = resolve(options.skillsDir ?? join(homedir(), ".agents", "skills"));
  // Check all conflicts before writing either destination.
  const links = await Promise.all([
    planLink(join(binDir, "dynamicwf"), executable, options.replace ?? false),
    planLink(join(skillsDir, "dynamic-workflows"), skill, options.replace ?? false),
  ]);
  for (const link of links) {
    if (link.action === "unchanged") continue;
    await mkdir(dirname(link.path), { recursive: true });
    if (link.action === "create") await symlink(link.target, link.path);
    else {
      // Only explicitly selected symlinks are replaced; ordinary files are never overwritten.
      const current = await lstat(link.path);
      if (!current.isSymbolicLink()) throw new Error(`Destination changed during setup: ${link.path}`);
      const temporary = `${link.path}.${randomUUID()}.tmp`;
      try { await symlink(link.target, temporary); await rename(temporary, link.path); }
      finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
    }
  }
  return { root, executable: join(binDir, "dynamicwf"), skill: join(skillsDir, "dynamic-workflows"), links,
    binOnPath: (process.env.PATH ?? "").split(":").some(entry => resolve(entry) === binDir) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      "bin-dir": { type: "string" }, "skills-dir": { type: "string" }, replace: { type: "boolean" }, help: { type: "boolean" },
    } });
    if (values.help) process.stdout.write("Usage: node --import tsx scripts/setup.ts [--bin-dir directory] [--skills-dir directory] [--replace]\nInstalls symlinks only. No sudo, dependencies, credentials or harness settings are changed.\n");
    else {
      const result = await setup({ ...(values["bin-dir"] ? { binDir: values["bin-dir"] } : {}), ...(values["skills-dir"] ? { skillsDir: values["skills-dir"] } : {}), ...(values.replace ? { replace: true } : {}) });
      process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
