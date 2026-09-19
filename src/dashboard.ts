import { randomBytes, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { chmod, mkdir, open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { defaultStorePath } from "./service.js";

const executable = fileURLToPath(new URL("../bin/dynamicwf.mjs", import.meta.url));
export const dashboardLabel = (directory: string) => `local.dynamicwf.dashboard.${createHash("sha256").update(resolve(directory)).digest("hex").slice(0, 12)}`;
export const dashboardDirectory = () => resolve(process.env.DYNAMICWF_UI_STATE_DIR ?? join(homedir(), ".dynamicwf", "dashboard"));
export interface DashboardConfig { version: 1; store: string; port: number; key: string }
export const dashboardUrl = (config: DashboardConfig, run?: string) =>
  `http://127.0.0.1:${config.port}/${run ? `?run=${encodeURIComponent(run)}` : ""}`;
export const dashboardStoreId = (store: string) => createHash("sha256").update(store).digest("hex");

export async function readDashboardConfig(directory = dashboardDirectory()): Promise<DashboardConfig | null> {
  let raw: string;
  try { raw = await readFile(join(directory, "config.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const c = JSON.parse(raw);
  if (c.version !== 1 || typeof c.store !== "string" || !c.store.startsWith("/") || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || !/^[a-f0-9]{48}$/.test(c.key))
    throw new Error("Invalid dashboard config; inspect " + join(directory, "config.json"));
  return c;
}
async function canonicalStore(store: string) {
  const absolute = resolve(store);
  await mkdir(dirname(absolute), { recursive: true });
  try { return await realpath(absolute); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return join(await realpath(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
}
export async function dashboardAlive(config: DashboardConfig): Promise<boolean> {
  try {
    const response = await fetch(`${dashboardUrl(config)}__dynamicwf/identity`, {
      headers: { "X-Dynamicwf-Manager": config.key }, signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const identity = await response.json() as { service?: string; version?: number; storeId?: string };
    return identity.service === "dynamicwf-dashboard" && identity.version === 1 && identity.storeId === dashboardStoreId(config.store);
  } catch { return false; }
}
async function stopDashboard(config: DashboardConfig) {
  if (!await dashboardAlive(config)) return;
  const response = await fetch(`${dashboardUrl(config)}__dynamicwf/stop`, {
    method: "POST", headers: { "X-Dynamicwf-Manager": config.key }, signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("Could not stop the dashboard viewer");
  for (let i = 0; i < 50; i++) { if (!await dashboardAlive(config)) return; await delay(100); }
  throw new Error("Dashboard is still closing; try again");
}

/** A database transaction serializes CLI processes and releases automatically on crash. */
async function lock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const db = new DatabaseSync(join(directory, "manager.sqlite"));
  try {
    for (let i = 0; i < 200; i++) {
      try {
        db.exec("BEGIN IMMEDIATE");
        return async () => { try { db.exec("ROLLBACK"); } finally { db.close(); } };
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== 5) throw error;
      }
      await delay(100);
    }
    throw new Error("Dashboard manager is busy; try again shortly");
  } catch (error) { db.close(); throw error; }
}
const domain = () => `gui/${process.getuid!()}`;
function registered(directory: string) {
  const label = dashboardLabel(directory);
  if (process.platform !== "darwin") return false;
  try { execFileSync("/bin/launchctl", ["print", `${domain()}/${label}`], { stdio: "ignore" }); return true; }
  catch { return false; }
}
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function dashboardPlist(directory: string, node = process.execPath, command = executable, path = process.env.PATH ?? "/usr/bin:/bin") {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${dashboardLabel(directory)}</string>
<key>ProgramArguments</key><array>${[node, command, "ui", "--serve"].map(v => `<string>${xml(v)}</string>`).join("")}</array>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string><key>DYNAMICWF_UI_STATE_DIR</key><string>${xml(directory)}</string></dict>
<key>WorkingDirectory</key><string>${xml(dirname(dirname(command)))}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>${xml(join(directory, "server.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory, "server.log"))}</string>
</dict></plist>\n`;
}
async function launchDetached(directory: string) {
  const log = await open(join(directory, "server.log"), "a", 0o600);
  try {
    const child = spawn(process.execPath, [executable, "ui", "--serve"], {
      cwd: dirname(dirname(executable)), detached: true, stdio: ["ignore", log.fd, log.fd, "ipc"],
      env: { ...process.env, DYNAMICWF_UI_STATE_DIR: directory },
    });
    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Dashboard startup timed out; see " + join(directory, "server.log"))); }, 15_000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Dashboard exited (${code}); port may be occupied. See ${join(directory, "server.log")}`)); });
      child.once("message", (message: unknown) => {
        clearTimeout(timeout);
        if ((message as { ready?: boolean })?.ready !== true) { child.kill(); reject(new Error("Invalid dashboard startup response")); return; }
        child.disconnect(); child.unref(); resolveReady();
      });
    });
  } finally { await log.close(); }
}
export async function manageDashboard(options: { store?: string; port?: number; install?: boolean; uninstall?: boolean } = {}, directory = dashboardDirectory()) {
  if ((options.install || options.uninstall) && process.platform !== "darwin") throw new Error("Login startup is currently supported on macOS only; ordinary background UI works without it");
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new Error("Persistent dashboard needs a port from 1 to 65535; use --foreground --port 0 for a temporary viewer");
  const release = await lock(directory);
  try {
    const previous = await readDashboardConfig(directory);
    const label = dashboardLabel(directory);
    const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
    if (options.uninstall) {
      if (registered(directory)) execFileSync("/bin/launchctl", ["bootout", `${domain()}/${label}`]);
      if (previous) await stopDashboard(previous);
      await unlink(plist).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
      return { url: previous ? dashboardUrl(previous) : null, running: false, loginStartup: false };
    }
    const config: DashboardConfig = {
      version: 1, store: await canonicalStore(options.store ?? previous?.store ?? defaultStorePath()),
      port: options.port ?? previous?.port ?? 4380, key: previous?.key ?? randomBytes(24).toString("hex"),
    };
    const alive = previous !== null && await dashboardAlive(previous);
    if (alive && (config.store !== previous.store || config.port !== previous.port))
      throw new Error(`Dashboard already uses ${previous.store} at ${dashboardUrl(previous)}. Use --uninstall before reconfiguring, or --foreground --port 0 for another store.`);
    const temp = join(directory, `config-${process.pid}.tmp`);
    await writeFile(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, join(directory, "config.json"));
    if (options.install) {
      await mkdir(dirname(plist), { recursive: true });
      // Refuse to replace a different program accidentally using our filename.
      const existing = await readFile(plist, "utf8").catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; });
      if (existing && !existing.includes(`<string>${xml(executable)}</string>`)) throw new Error("Existing dashboard LaunchAgent points to another installation: " + plist);
      if (registered(directory)) execFileSync("/bin/launchctl", ["bootout", `${domain()}/${label}`]);
      await stopDashboard(config);
      await writeFile(plist, dashboardPlist(directory), { mode: 0o600 });
      execFileSync("/bin/launchctl", ["enable", `${domain()}/${label}`]);
      execFileSync("/bin/launchctl", ["bootstrap", domain(), plist]);
    } else if (!alive) {
      if (registered(directory)) execFileSync("/bin/launchctl", ["kickstart", `${domain()}/${label}`]);
      else await launchDetached(directory);
    }
    for (let i = 0; i < 50; i++) {
      if (await dashboardAlive(config)) return { url: dashboardUrl(config), running: true, loginStartup: registered(directory) };
      await delay(100);
    }
    throw new Error("Dashboard did not become ready; inspect " + join(directory, "server.log"));
  } finally { await release(); }
}
