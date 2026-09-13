# Frozen execution plans

For the public `workflow.prepare` saved handle and exact/idempotent `run.start`, see
[prepared-start.md](prepared-start.md). The library function below still returns the
plan itself; the service response wraps it under `plan` with identity/workspace metadata.

`prepareExecutionPlan(workflow, { cwd, defaultModel? })` validates and compiles the
whole graph before starting any inference. It creates an immutable, JSON-serializable
`ExecutionPlan`, containing the validated graph, exact generated TypeScript + Effect
source, compiler/runtime versions, source SHA-256 and an overall SHA-256.

Each agent is addressed by `plan.agents[graphId][nodeId]`. Its role configuration is
resolved once: actual model/provider, actual thinking level, prompt, tools, permission,
session policy, output schema and skill resources are all frozen. A custom
`systemPrompt` replaces the role prompt as documented in the authoring contract;
the worker adds the mandatory result submission protocol separately.

The normal model catalog comes from pi `ModelRuntime.getAvailableSnapshot()` after
local authenticated discovery with network catalog refreshing disabled. An explicit
node model or installation `defaultModel` must be available. With neither configured,
prefer available `openai-codex/gpt-5.6-sol`, then the first available model. An empty
catalog produces an actionable error. Graphs with no agent nodes need no model
catalog or authentication.

Thinking capabilities come from pi's `getSupportedThinkingLevels(model)`. Explicit
unsupported thinking levels fail before inference. Role default thinking adapts to
the nearest supported level at or below the default, otherwise the first supported
level; the resulting concrete level is visible in the plan. It is never left to
worker startup to silently change an explicit request. Tests inject
`availableModels: [{ provider, id, thinkingLevels }]`, avoiding authentication and
provider calls.

## Skills

A skill reference is a directory or its `SKILL.md`, absolute or relative to the run's
`cwd`. Preparation copies every regular file in the skill directory into the plan,
including supporting scripts and binary resources, encoded as base64. It preserves
whether a file is executable. File paths are relative to the skill root; snapshots
have a name and SHA-256 over the name and file contents/modes. Duplicate skill names,
symlink resources, traversal paths, special files and missing `SKILL.md` fail.

Recognizable credential/private metadata filenames (`.env`, `auth.json`, credentials,
private-key formats, `.ssh`, `.aws`, `.git`) fail preparation instead of being copied.
This filename exclusion is not a content-level secret scanner: skill authors must
keep credentials outside skill resources. Model credentials are never included in
execution plans. Workers materialize the frozen resources, so editing or removing
the original skill cannot change an already prepared run.

## Structured output

`createOutputValidator(schema)` returns a synchronous validator that either throws
or returns a cloned JSON result. It uses pinned Ajv 8.20.0 with strict schema checking,
without type coercion, default insertion or additional-property removal. Root type
must be `object`, because the schema is also the `submit_result` tool-argument schema.
JSON Schema 2020-12 is the default; explicit draft-07 is also supported. Local
references work; remote/external references, async schemas, unsupported dialects,
unknown keywords and unknown formats fail during preparation. Schema metadata and
literal values are preserved without interpreting `$ref` keys inside `const` data.

The default schema is:

```json
{"type":"object","properties":{"result":{}},"required":["result"],"additionalProperties":false}
```

Reviewers retain the catalog's structured verdict schema. The JSON boundary rejects
NaN, undefined, bigint, getters, cycles, unusual object prototypes, symbols, and sparse
or extended arrays before schema validation can coerce or inspect them.

## Loading a persisted plan

New plans use `dynamicwf-effect-v9` / `dynamicwf-runtime-v9` with reuse nodes, frozen effective capabilities, optional agent image requirements, adapter identity and distinct available/requested/resolved thinking. This runtime also
verifies and executes paired v1–v8 plans by regenerating their
byte-identical source. The v8 golden fixture `tests/fixtures/legacy-v8-plan.json` keeps frozen capability keys without reuse semantics. The v2 golden fixture predates routing (`034b270`).
The golden fixture `tests/fixtures/legacy-v1-plan.json` was produced by the compiler
at commit `4b4ae53`; it guards source/hash compatibility. V1 rejects new finish/await
nodes. V1/v2 plans do not gain fabricated historical routing records. This is
explicit compatibility for these versions, not arbitrary rollback. The v3 golden
agent fixture was generated at `a05b3ef`, before output repair. V1–v3 plans retain
their exact eight frozen agent fields and disable repair; v4 and newer plans require
`outputRepair` explicitly, including `{ "mode": "disabled" }` for the default.
Older compilers reject authored output repair configuration.
The v4 golden map/parallel fixture was generated with the compiler from `f933bd9`;
it still returns unwrapped child values. V5 and newer support authored `failurePolicy`.
The golden v5 collect fixture was generated at `6dcafc3`; v6 adds node-level
`retryPolicy` on agent/check. Older compilers reject authored retry policies.
See [retry-policy.md](retry-policy.md) for admission and persistence semantics.
The golden v7 fixture `tests/fixtures/legacy-v7-plan.json` was captured before the v8 capability fields; v7 agents keep eight frozen keys plus `outputRepair` and do not gain retrospective capabilities.
The golden v6 retry fixture was generated at `61fdb9a`; it retains original
code-family selection and delay. V7 adds explicit provider HTTP filtering and
Retry-After policy; v6 and older compilers reject those provider options.

`verifyExecutionPlan(value)` checks JSON structure, exact field sets, graph validity,
agent coverage/configuration, output schemas, safe skill resource paths and hashes,
supported versions, regenerated source equality, source hash and overall plan hash.
It returns a deeply frozen independent copy. It does not rediscover models, reread
skills, refresh credentials, or apply updated role defaults. Consequently a stored
run can be inspected even when its provider authorization is unavailable.

Hashes detect accidental or unacknowledged content changes; they are not signatures
against an attacker who can replace both the plan and its hashes. Actual provider
availability and credentials are checked again by the worker at execution time;
that check must fail explicitly if the frozen request cannot be fulfilled.

Validation: `node --import tsx --test tests/execution-plan.test.ts` covers freezing,
model/thinking selection, no-agent execution planning, explicit overrides, skill
version changes/removal, binary/executable files, unsafe resources, schema dialects,
strict output validation, and tampered persisted plans.
