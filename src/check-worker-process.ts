import { spawn } from "node:child_process";
import { executionFailure, failureRecord } from "./execution-failure.js";

let child: ReturnType<typeof spawn> | undefined;
let stopped = false;
let escalation: NodeJS.Timeout | undefined;
let commandAdmitted = false;
function cancel() {
  if (stopped) return;
  stopped = true;
  // This wrapper is the group leader; ordinary command descendants share it.
  try { process.kill(-process.pid, "SIGTERM"); } catch { child?.kill("SIGTERM"); }
  escalation = setTimeout(() => {
    try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(1); }
  }, 2_000);
  escalation.unref();
}
process.on("SIGTERM", cancel);
process.on("SIGINT", cancel);
process.on("disconnect", cancel);
if (typeof process.send === "function" && !process.connected) cancel();
try {
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  if (stopped) throw new Error("Check cancelled before admission");
  const request = JSON.parse(input) as { command: string; args: string[]; cwd: string };
  if (typeof request.command !== "string" || !Array.isArray(request.args) || request.args.some(x => typeof x !== "string") || typeof request.cwd !== "string") throw new Error("Invalid check request");
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    child = spawn(request.command, request.args, { cwd: request.cwd, shell: false, detached: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (data: string) => { stdout += data; });
    child.stderr!.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
    child.once("spawn", () => { commandAdmitted = true; });
    child.once("error", error => reject(executionFailure("process",commandAdmitted ? "execution" : "setup",commandAdmitted ? "unknown" : "not-started",`${commandAdmitted ? "Check process error" : "Check command could not start"} (${(error as NodeJS.ErrnoException).code ?? "unknown cause"})`)));
    child.once("close", (code, signal) => {
      if (stopped) reject(new Error("Check cancelled"));
      else if (code === null) reject(executionFailure("process","execution","unknown",`Check terminated by ${signal}`));
      else resolve({ exitCode: code, stdout, stderr });
    });
  });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  const failure = failureRecord(error,{code:stopped ? "cancelled" : "unknown",phase:commandAdmitted ? "execution" : "setup",effects:commandAdmitted ? "unknown" : "not-started",message:stopped ? "Check cancelled" : "Check wrapper failed"});
  process.stdout.write(JSON.stringify({type:"error",failure}) + "\n");
  process.exitCode = 1;
} finally {
  // The direct command may have exited on TERM while a descendant ignored it.
  // Do not discard the only cleanup owner when the IPC parent is already gone.
  if (stopped) {
    try { process.kill(-process.pid, "SIGKILL"); } catch { /* no remaining group */ }
  }
  if (escalation) clearTimeout(escalation);
  process.off("disconnect", cancel);
  if (process.connected) process.disconnect();
}
