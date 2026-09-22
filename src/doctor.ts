import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { AvailableExecutionModel } from "./execution-plan.js";
import { discoverWorkflowCatalog } from "./model-runtime.js";

export interface DoctorCheck { id: string; status: "ok" | "unavailable" | "error"; detail: string }
export interface DoctorReport {
  cwd: string;
  store: string;
  checks: DoctorCheck[];
  models: AvailableExecutionModel[];
  issues: string[];
  readyFor: { pureRuns: boolean; agentRuns: boolean; grok: boolean; workspaceWrites: boolean };
}
export interface DoctorOptions {
  cwd: string;
  filename: string;
  /** Explicit catalog injection for offline tests and embedding; never reads local credentials when supplied. */
  availableModels?: readonly AvailableExecutionModel[];
  nodeVersion?: string;
  platform?: NodeJS.Platform;
}
const execute = promisify(execFile);
function supportedNode(version: string): boolean {
  const parts = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!parts || parts[0] !== version) return false;
  return Number(parts[1]) > 22 || Number(parts[1]) === 22 && Number(parts[2]) >= 19;
}
async function permitted(path: string, mode: number): Promise<boolean> { try { await access(path, mode); return true; } catch { return false; } }
async function canStore(filename: string): Promise<{ status: DoctorCheck["status"]; detail: string }> {
  if (filename === ":memory:") return { status: "unavailable", detail: "Detached workflows require a persistent state filename" };
  try {
    try {
      const file = await stat(filename);
      if (!file.isFile()) return { status: "unavailable", detail: "State path exists but is not a regular file" };
      if (!(await permitted(filename, constants.R_OK | constants.W_OK))) return { status: "unavailable", detail: "Existing state file is not readable and writable" };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let parent = dirname(filename);
    for (;;) {
      try { if (!(await stat(parent)).isDirectory()) return { status: "unavailable", detail: "State path parent is not a directory" }; break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(parent) === parent) throw error;
        parent = dirname(parent);
      }
    }
    if (!(await permitted(parent, constants.R_OK | constants.W_OK | constants.X_OK))) return { status: "unavailable", detail: "State directory cannot support SQLite database and journal files" };
    // Probe a new temporary sibling only. Never open/create/alter the selected DB.
    const probe = await mkdtemp(join(parent, ".dynamicwf-doctor-"));
    try { await writeFile(join(probe, "write-probe"), "ok", { flag: "wx", mode: 0o600 }); }
    finally { await rm(probe, { recursive: true, force: true }); }
    return { status: "ok", detail: "Persistent state location supports creating writable files; existing database content was not modified" };
  } catch { return { status: "unavailable", detail: "Persistent state location is inaccessible or does not permit creating writable files" }; }
}

/** Local diagnosis: no inference, no model network refresh, no database construction. */
export async function diagnoseSystem(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const cwd = resolve(options.cwd), store = options.filename === ":memory:" ? options.filename : resolve(options.filename);
  const nodeVersion = options.nodeVersion ?? process.version, platform = options.platform ?? process.platform;
  const nodeReady = supportedNode(nodeVersion), groupsReady = platform !== "win32";
  checks.push({ id: "node", status: nodeReady ? "ok" : "unavailable", detail: `${nodeVersion}; requires Node >=22.19.0` });
  checks.push({ id: "process-groups", status: groupsReady ? "ok" : "unavailable", detail: groupsReady ? `${platform}: POSIX process groups are supported by the local runtime` : "Detached worker group cancellation currently requires a POSIX platform" });
  let workspaceExists = false, workspaceReads = false, workspaceWrites = false;
  try { workspaceExists = (await stat(await realpath(cwd))).isDirectory(); } catch { /* Report absent/inaccessible without raw filesystem errors. */ }
  if (workspaceExists) {
    workspaceReads = await permitted(cwd, constants.R_OK | constants.X_OK);
    workspaceWrites = await permitted(cwd, constants.W_OK | constants.X_OK);
  }
  checks.push({ id: "workspace", status: workspaceExists ? "ok" : "unavailable", detail: workspaceExists ? "Workspace directory exists" : "Workspace directory is missing, inaccessible, or not a directory" });
  checks.push({ id: "workspace-read", status: workspaceReads ? "ok" : "unavailable", detail: workspaceReads ? "Workspace permits reading and directory traversal" : "Workspace reading/traversal is unavailable" });
  checks.push({ id: "workspace-write", status: workspaceWrites ? "ok" : "unavailable", detail: workspaceWrites ? "Workspace permits writing under current OS access checks" : "Workspace writes are unavailable; read-only tasks may still run" });
  const state = await canStore(store); checks.push({ id: "persistent-state", ...state });
  try {
    const { stdout } = await execute("git", ["--version"], { timeout: 5000, maxBuffer: 4096 });
    checks.push({ id: "git", status: "ok", detail: stdout.trim().replace(/[\x00-\x1f\x7f]/g, " ") });
  } catch { checks.push({ id: "git", status: "unavailable", detail: "Git executable is unavailable; non-Git workflows can still run" }); }
  let sdkReady = false;
  try {
    const installation = fileURLToPath(new URL("../", import.meta.url));
    await execute(process.execPath, [join(installation, "scripts/sdk-patches.mjs"), "--check"], { cwd: installation, timeout: 5000, maxBuffer: 16_384 });
    sdkReady = true;
    checks.push({ id: "sdk-patches", status: "ok", detail: "Версии и SHA256 локальных исправлений SDK проверены; файлы не изменялись" });
  } catch {
    checks.push({ id: "sdk-patches", status: "error", detail: "Исправления SDK не проверены. В каталоге установки выполните npm run sdk:check; известное частичное состояние исправляет npm run sdk:apply, неизвестные файлы требуют npm ci" });
  }
  let models: AvailableExecutionModel[] = [], issues: string[] = [];
  try {
    if (options.availableModels !== undefined) models = structuredClone([...options.availableModels]);
    else ({ models, issues } = await discoverWorkflowCatalog());
    checks.push({ id: "authenticated-models", status: models.length ? "ok" : "unavailable", detail: options.availableModels !== undefined ? `Explicitly supplied model catalog: ${models.length} models (credentials were not inspected)` : `Cache-only authenticated catalog: ${models.length} models; no inference or catalog network refresh` });
  } catch {
    issues.push("Authenticated model discovery failed; check local pi authentication and provider installation");
    checks.push({ id: "authenticated-models", status: "error", detail: "Model discovery failed; credentials and provider errors are not included" });
  }
  const pureRuns = nodeReady && groupsReady && workspaceExists && workspaceReads && state.status === "ok";
  return { cwd, store, checks, models, issues, readyFor: { pureRuns, agentRuns: pureRuns && sdkReady && models.length > 0, grok: pureRuns && sdkReady && models.some(model => model.provider === "xai"), workspaceWrites: pureRuns && workspaceWrites } };
}
