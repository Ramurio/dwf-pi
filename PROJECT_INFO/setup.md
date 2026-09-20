# One-time local setup

Run from the checked-out project with Node.js 22.19 or newer:

```sh
npm ci
node --import tsx scripts/setup.ts
```

Setup creates two symlinks:

- `~/.local/bin/dynamicwf` points to this checkout's executable.
- `~/.agents/skills/dynamic-workflows` points to the portable skill directory.

No sudo is required. Setup does not install dependencies, acquire credentials, modify shell startup files, or edit harness settings. Put `~/.local/bin` on your existing shell's `PATH` if it is not there; setup reports `binOnPath`. The checkout and its `node_modules` remain the installed application, so keep them available. If the project moves, rerun setup from its new location with `--replace` to repoint existing symlinks. Ordinary files and directories are never overwritten, even with `--replace`.

Choose other directories explicitly when a harness discovers skills elsewhere:

```sh
node --import tsx scripts/setup.ts --bin-dir /path/to/bin --skills-dir /path/to/skills
```

Repeat with another `--skills-dir` to expose the same skill in multiple harnesses. `~/.agents/skills` is a common layout, not a promise that every harness automatically scans it. A harness can also read `skills/dynamic-workflows/SKILL.md` directly. If a harness does not follow skill-directory symlinks, copy that directory to its supported skill location and refresh the copy after updates.

The executable works from any workspace:

```sh
dynamicwf catalog.list <<'JSON'
{}
JSON

dynamicwf workflow.schema <<'JSON'
{}
JSON

dynamicwf watch --run run-… --once
dynamicwf mcp
```

CLI tools take one JSON object on stdin and return one JSON envelope on stdout. Dotted tool names become underscore names in MCP (`workflow.patch` → `workflow_patch`). The executable registers the installed `tsx/esm/api` loader and imports the CLI, watch or MCP entry point in the same Node process. It does not spawn a transport wrapper or change the working directory. Only execution supervisors/workers are detached.

For a harness with MCP support, configure its normal stdio server entry to run the absolute installed executable with arguments `["mcp"]`. Add `--store /absolute/state.sqlite` for a nondefault journal, or `--cwd /absolute/workspace` for an MCP server's default execution workspace. This project does not modify those harness-specific settings automatically. A client can instead pass an explicit `cwd` in each run request. CLI use needs no MCP configuration.

The default state directory is `$DYNAMICWF_HOME`, falling back to `~/.dynamicwf`. A separate `--store` flag selects another journal. The worker models and authentication come from pi's local provider setup, independently of the calling harness. Installing this command/skill does not turn a chat subscription name into an API model or transfer credentials between products. Use the project's model diagnostics before selecting a concrete model.

To remove the setup, remove the two installed symlinks. That does not remove the checkout, journal, presets or running workflows. Existing supervisors keep running independently of the invoking harness. See [watch.md](watch.md) for monitoring and detachment behavior.
