import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { WorkflowService, serviceToolNames } from "./service.js";
import { ExecutionFailure } from "./execution-failure.js";

let service: WorkflowService | undefined;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    store: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: npm run --silent cli -- <tool> [--store state.sqlite] < request.json\n" +
      `Tools: ${serviceToolNames.join(", ")}\n` +
      "One JSON request on stdin; one JSON response on stdout. Runs continue in detached supervisor processes after this command exits.");
  } else {
    if (positionals.length !== 1) throw new Error("Specify exactly one tool; use --help");
    const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim();
    const request: unknown = raw ? JSON.parse(raw) : {};
    service = new WorkflowService(values.store);
    const result = await service.dispatch(positionals[0]!, request);
    console.log(JSON.stringify({ ok: true, result }));
  }
} catch (error) {
  const failure = error instanceof Error ? error : new Error("Unknown failure");
  console.log(JSON.stringify({ ok: false, error: {
    name: failure.name, message: failure.message,
    ...(failure instanceof ExecutionFailure ? { failure: failure.failure } : {}),
    ...("issues" in failure ? { issues: failure.issues } : {}),
  } }));
  process.exitCode = 1;
} finally { service?.close(); }
