import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "dynamicwf-sdk-clean-"));
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", chunk => { out += chunk; });
  child.stderr.on("data", chunk => { out += chunk; });
  child.on("error", reject);
  child.on("close", code => code === 0 ? resolve(out) : reject(new Error(`${command} ${args.join(" ")}\n${out}`)));
});

try {
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name: "dynamicwf-sdk-clean-import", private: true, type: "module",
    dependencies: {
      "@earendil-works/pi-agent-core": "0.85.1",
      "@earendil-works/pi-ai": "0.85.1",
      "@earendil-works/pi-coding-agent": "0.85.1",
    },
  }, null, 2));
  await run("npm", ["install", "--omit=dev", "--no-fund", "--no-audit"], directory);
  await writeFile(join(directory, "probe.mjs"), `
    import { readFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    import { fileURLToPath } from "node:url";
    import * as coding from "@earendil-works/pi-coding-agent";
    import * as ai from "@earendil-works/pi-ai";
    import * as compat from "@earendil-works/pi-ai/compat";
    import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
    if (typeof coding.resizeImage !== "function") throw new Error("resizeImage missing");
    if (typeof coding.createAgentSession !== "function") throw new Error("createAgentSession missing");
    if (typeof coding.createReadToolDefinition !== "function") throw new Error("createReadToolDefinition missing");
    if (typeof ai.lazyStream !== "function") throw new Error("lazyStream missing");
    if (!compat) throw new Error("compat missing");
    if (!xaiProvider()?.auth?.oauth) throw new Error("native xai oauth missing");
    try { await import("@earendil-works/pi-server"); throw new Error("pi-server should not resolve"); }
    catch (error) { if (error.message === "pi-server should not resolve") throw error; }
    let dir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai")));
    let version = "";
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        if (pkg.name === "@earendil-works/pi-ai") { version = pkg.version; break; }
      } catch {}
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    console.log(JSON.stringify({ ok: true, piAi: version, resize: "async-function" }));
  `);
  const output = await run(process.execPath, ["probe.mjs"], directory);
  process.stdout.write(output);
} finally {
  await rm(directory, { recursive: true, force: true });
}
