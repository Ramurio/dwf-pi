/** Dedicated child entry point. stdout is exclusively the versioned NDJSON protocol. */
import { executionFailure, failureRecord } from "./execution-failure.js";
import { executePiWorker } from "./pi-worker.js";
import type { PiWorkerMessage, PiWorkerRequest } from "./execution-types.js";

const stdout = process.stdout.write.bind(process.stdout);
console.log = console.info = console.debug = (..._args: unknown[]) => { /* SDK diagnostics cannot corrupt the protocol or disclose request/auth data. */ };
const send = (message: PiWorkerMessage) => stdout(`${JSON.stringify(message)}\n`);
const controller = new AbortController();
const cancel = () => { controller.abort(); process.stdin.destroy(); };
process.on("SIGTERM", cancel);
process.on("SIGINT", cancel);
process.on("disconnect", cancel);
// A dead supervisor also closes its output pipe. Consume EPIPE so cleanup can
// drain the SDK's active tools instead of crashing before their abort settles.
process.stdout.on("error", cancel);
// IPC may have closed while static imports were still loading.
if (typeof process.send === "function" && !process.connected) cancel();
send({ type: "ready" });
let executionAdmitted = false;
try {
  let text = "";
  for await (const chunk of process.stdin) {
    if (controller.signal.aborted) throw new Error("Pi worker cancelled");
    text += chunk.toString();
  }
  const request = JSON.parse(text) as PiWorkerRequest;
  executionAdmitted = true;
  const result = await executePiWorker(request, { signal: controller.signal, onEvent: event => { send({ type: "event", event }); } });
  if (controller.signal.aborted) throw executionFailure("cancelled","output","unknown","Pi worker cancelled");
  send({ type: "result", result });
} catch (error) {
  // Only branded, closed failures cross IPC. Arbitrary SDK text is never admitted by a prefix match.
  const failure = failureRecord(error, { code: controller.signal.aborted ? "cancelled" : "unknown",
    phase: executionAdmitted ? "unknown" : "setup", effects: executionAdmitted ? "unknown" : "not-started", message: controller.signal.aborted ? "Pi worker cancelled" : "Pi worker failed before a structured result" });
  send({ type: "error", error: failure.message, failure });
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  process.removeListener("SIGTERM", cancel);
  process.removeListener("SIGINT", cancel);
  process.removeListener("disconnect", cancel);
  if (process.connected) process.disconnect();
}
