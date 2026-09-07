# Model discovery and local diagnosis

`catalog.models` (`catalog_models` over MCP) returns `{ models, issues }`. Each model has concrete `provider`, `id` and supported pi `thinkingLevels`. Default discovery uses local cached authenticated catalogs and does not start inference or refresh model catalogs over the network. `{ "refresh": true }` explicitly refreshes the authenticated Grok catalog. Subscription labels such as Heavy are not substitutes for actual model IDs. Inspect `issues`, especially stale or missing Grok catalog data.

`system.doctor` (`system_doctor` over MCP) accepts optional `{ "cwd": "..." }`, relative to the service working directory or absolute. It returns the selected `cwd` and persistent `store`, individual checks, safe model IDs/catalog issues, and separate prerequisite readiness flags:

- `pureRuns`: supported Node version and POSIX platform, readable workspace, and writable persistent state location.
- `agentRuns`: the same prerequisites plus at least one authenticated cached model candidate.
- `grok`: the same prerequisites plus at least one `xai-auth` model candidate; this is not a live entitlement or Heavy-tier check.
- `workspaceWrites`: the same prerequisites plus OS write/traversal access to the workspace.

Checks cover Node >=22.19.0, POSIX process-group support, workspace existence/read/write access, persistent-state storage, Git availability and the model catalog. Missing Git is reported separately because non-Git workflows can still run. Missing models do not block pure/check workflows. `:memory:` is unsuitable for detached execution and is reported as unavailable persistent state.

State diagnosis checks access and creates/removes a temporary sibling directory containing a write probe. It never opens, constructs, migrates or writes the selected database, nor creates the requested parent directory when it is missing. Existing state bytes and SQLite sidecars remain untouched. It does not validate existing database schema/content; readiness describes these local prerequisites, not a guarantee that an arbitrary workflow or existing database is healthy. Workspace write checks use OS access checks and create no workspace files unless that workspace also contains the chosen state-directory probe location.

Doctor never starts inference or requests network catalog refresh. It does not return credentials, auth-file paths, or raw provider errors. Model issues are safe summaries. Service `availableModels` injection supplies a deterministic catalog to both tools for offline tests and embedding; even an explicit refresh request uses that injected catalog without consulting external authentication.

Both MCP input schemas are closed. `system.doctor` intentionally has no refresh switch; explicit network catalog refresh belongs to `catalog.models`.

Verification: `node --import tsx --test tests/doctor.test.ts`. Tests cover missing state paths without creation, byte-preserving diagnosis of existing files, platform/version/workspace failures, invalid storage paths, model injection, schema rejection and MCP metadata.
