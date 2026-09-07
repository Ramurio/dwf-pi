/** Dedicated child entry point. stdout is exclusively the versioned NDJSON protocol. */
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
try {
  let text = "";
  for await (const chunk of process.stdin) {
    if (controller.signal.aborted) throw new Error("Pi worker cancelled");
    text += chunk.toString();
  }
  const request = JSON.parse(text) as PiWorkerRequest;
  const result = await executePiWorker(request, { signal: controller.signal, onEvent: event => { send({ type: "event", event }); } });
  if (controller.signal.aborted) throw new Error("Pi worker cancelled");
  send({ type: "result", result });
} catch (error) {
  // Never forward arbitrary SDK/provider error text: it may include headers, prompts or credentials.
  const message = controller.signal.aborted ? "Pi worker cancelled" : error instanceof Error && /^(Grok subscription adapter is missing|Unsupported Grok adapter identity\/version|Grok subscription cached catalog|Grok subscription adapter could not be loaded|Pi worker cancelled|submit_result |Pi worker completed without|Pi assistant turn failed|Pi changed configured|Configured model is not available|read-only worker cannot|Fresh worker cannot|Frozen skill|Unsafe frozen skill|Invalid frozen skill|Resource directory|Duplicate frozen skill|Unsupported pi worker|Unknown pi worker|Continued session workspace|Pi tool allowlist)/.test(error.message)
    ? error.message : "Pi worker execution failed; inspect its private session transcript for details";
  send({ type: "error", error: message });
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  process.removeListener("SIGTERM", cancel);
  process.removeListener("SIGINT", cancel);
  process.removeListener("disconnect", cancel);
  if (process.connected) process.disconnect();
}
