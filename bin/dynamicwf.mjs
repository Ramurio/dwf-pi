#!/usr/bin/env node
import { fileURLToPath } from "node:url";

// Keep CLI/MCP stdio and process lifetime in this process. Detached supervisors
// are launched by RunController, never by this dispatch entry point.
const arguments_ = process.argv.slice(2);
const command = arguments_[0];
const entry = (command === "graph" || command === "ui") ? "../src/graph-view.ts" : command === "watch" ? "../src/watch.ts" : command === "mcp" ? "../src/mcp.ts" : "../src/cli.ts";
const forwarded = command === "watch" || command === "mcp" || (command === "graph" || command === "ui") ? arguments_.slice(1) : arguments_;
if (command === "--help" || command === "-h") {
  process.stdout.write("dynamicwf <tool> [--store state.sqlite] < request.json\ndynamicwf watch --run <id> [--store state.sqlite] [--once] [--graph] [--plain]\ndynamicwf ui [--run <id>] [--store state.sqlite] [--port 4380]\ndynamicwf ui --install | --uninstall | --foreground\ndynamicwf mcp [--store state.sqlite] [--cwd workspace]\n\nTools use dotted names: workflow.create, workflow.patch, run.start, run.status, preset.save.\nUse dynamicwf workflow.schema to inspect graph authoring schemas.\n");
} else {
  try {
    const { register } = await import("tsx/esm/api");
    register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });
    const target = new URL(entry, import.meta.url);
    process.argv = [process.execPath, fileURLToPath(target), ...forwarded];
    await import(target.href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`dynamicwf: ${message.replace(/[\x00-\x1f\x7f-\x9f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`);
    process.exitCode = 1;
  }
}
