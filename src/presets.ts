import { link, lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { verifyExecutionPlan } from "./execution-plan.js";
import type { ExecutionPlan } from "./execution-types.js";
import type { RunRecord } from "./run-store.js";
import { legacyOutcome } from "./task-outcome.js";
import { planHasReuse } from "./lineage.js";

export interface PresetRecord {
  version: 1;
  name: string;
  revision: string;
  savedAt: number;
  plan: ExecutionPlan;
}
export interface PresetDiagnostic {
  kind: "diagnostic";
  name: string;
  revision: string | null;
  reason: string;
}
export interface PresetScan { records: PresetRecord[]; diagnostics: PresetDiagnostic[] }
function safeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return ["Preset directory must be a real directory", "Preset revision must be a real JSON file",
    "Invalid preset record", "Preset revision and execution plan hash differ",
    "Execution plan compiled source or source hash mismatch", "Execution plan hash mismatch"].includes(message)
    ? message : error instanceof SyntaxError ? "Invalid preset JSON" : "Preset unreadable or frozen plan verification failed";
}
export type PresetScope = "global" | "project";
export function presetName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid preset name");
  return value;
}
export function presetRevision(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid preset revision hash");
  return value;
}

/** Immutable, portable JSON snapshots; project presets can be tracked in Git. */
export class PresetLibrary {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private async directory(path: string, create = false): Promise<boolean> {
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Preset directory must be a real directory");
      return true;
    } catch (error) { if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  async save(name: string, run: RunRecord): Promise<PresetRecord> {
    presetName(name);
    if (run.status !== "succeeded") throw new Error("Only a successful run can be saved as a tested preset");
    if ((run.taskOutcome ?? legacyOutcome(run.output ?? null)).decision !== "accepted") throw new Error("Only an accepted task outcome can be saved as a tested preset");
    const plan = verifyExecutionPlan(run.plan);
    if (planHasReuse(plan.workflow)) throw new Error("План с reuse нельзя сохранить как самостоятельный пресет: ему нужны подтверждённые результаты исходного запуска. Используйте run.continue либо создайте и проверьте граф без reuse.");
    const record: PresetRecord = { version: 1, name, revision: plan.hash, savedAt: Date.now(), plan };
    await this.directory(this.root, true);
    const directory = join(this.root, name);
    await this.directory(directory, true);
    const target = join(directory, `${record.revision}.json`);
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      try { await link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    // A concurrent save of the same content is idempotent, preserving the first timestamp.
    return this.read(name, record.revision);
  }
  async read(name: string, revision?: string): Promise<PresetRecord> {
    presetName(name);
    if (revision !== undefined) presetRevision(revision);
    if (!await this.directory(this.root) || !await this.directory(join(this.root, name))) throw new Error(`Preset not found: ${name}`);
    if (revision === undefined) {
      const scan = await this.scan(name);
      if (scan.diagnostics.length) throw new Error(`Ambiguous latest for preset ${name}; specify an explicit revision hash: ${scan.diagnostics.map(d => d.reason).join("; ")}`);
      const latest = scan.records.at(-1);
      if (!latest) throw new Error(`Preset not found: ${name}`);
      return latest;
    }
    const path = join(this.root, name, `${revision}.json`);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Preset revision must be a real JSON file");
    const record = JSON.parse(await readFile(path, "utf8")) as PresetRecord;
    if (record === null || typeof record !== "object" || Array.isArray(record) ||
      Object.keys(record).sort().join(",") !== "name,plan,revision,savedAt,version" ||
      record.version !== 1 || record.name !== name || record.revision !== revision ||
      !Number.isSafeInteger(record.savedAt) || record.savedAt <= 0) throw new Error("Invalid preset record");
    const plan = verifyExecutionPlan(record.plan);
    if (plan.hash !== revision) throw new Error("Preset revision and execution plan hash differ");
    return { ...record, plan };
  }
  async names(): Promise<string[]> {
    if (!await this.directory(this.root)) return [];
    return (await readdir(this.root)).filter(name => /^[A-Za-z][A-Za-z0-9_-]*$/.test(name)).sort();
  }
  async hasName(name: string): Promise<boolean> {
    presetName(name);
    return (await this.names()).includes(name);
  }
  async scan(name: string): Promise<PresetScan> {
    presetName(name);
    const result: PresetScan = { records: [], diagnostics: [] };
    let files: string[];
    try {
      if (!await this.directory(this.root) || !await this.directory(join(this.root, name))) return result;
      files = (await readdir(join(this.root, name))).filter(file => /^[a-f0-9]{64}\.json$/.test(file)).sort();
    } catch (error) {
      result.diagnostics.push({ kind: "diagnostic", name, revision: null, reason: safeReason(error) });
      return result;
    }
    for (const file of files) {
      const revision = file.slice(0, -5);
      try { result.records.push(await this.read(name, revision)); }
      catch (error) { result.diagnostics.push({ kind: "diagnostic", name, revision, reason: safeReason(error) }); }
    }
    result.records.sort((a, b) => a.savedAt - b.savedAt || a.revision.localeCompare(b.revision));
    return result;
  }
  async versions(name: string): Promise<PresetRecord[]> {
    return (await this.scan(name)).records;
  }
  async list(): Promise<((PresetRecord & { latest?: false }) | PresetDiagnostic)[]> {
    const entries: ((PresetRecord & { latest?: false }) | PresetDiagnostic)[] = [];
    for (const name of await this.names()) {
      const { records, diagnostics } = await this.scan(name);
      if (diagnostics.length) entries.push(...records.map(record => ({ ...record, latest: false as const })), ...diagnostics);
      else if (records.length) entries.push(records.at(-1)!);
    }
    return entries;
  }
}

export function presetSummary(record: PresetRecord) {
  return { name: record.name, revision: record.revision, savedAt: record.savedAt,
    workflow: { id: record.plan.workflow.id, name: record.plan.workflow.name, revision: record.plan.workflow.revision },
    agents: Object.entries(record.plan.agents).flatMap(([graphId, agents]) => Object.entries(agents).map(([nodeId, config]) => ({
      graphId, nodeId, model: config.model, thinking: config.thinking,
      skills: config.skills.map(skill => ({ name: skill.name, hash: skill.hash })),
    }))) };
}
