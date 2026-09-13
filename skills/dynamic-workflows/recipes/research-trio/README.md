# Three independent researchers and a synthesizer

Portable authoring requests for a small graph: three isolated `researcher` branches in `parallel` with `failurePolicy:"collect"`, then a separate `synthesizer`, then a root `finish`. Copy these JSON files into your workspace and edit the copies. Do not write user parameters, CLI envelopes, or journal files back into the skill.

This recipe has no web tool. Researchers may read only files reachable from the prepare `cwd` with `read`, `grep`, `find` and `ls`.

## Copy from the installed skill

Work from any directory. `SKILL` is the skill tree your harness actually uses (setup symlink or a copied directory), not `examples/` or `src/` in a checkout.

```sh
SKILL="${DYNAMICWF_SKILL:-$HOME/.agents/skills/dynamic-workflows}"
RECIPE="$SKILL/recipes/research-trio"
STORE="${STORE:-$PWD/research-trio.sqlite}"
cp "$RECIPE/create.json" "$RECIPE/patch.json" "$RECIPE/input.json" .
```

CLI stdout is `{ "ok": true, "result": ... }` or `{ "ok": false, "error": ... }`. Check `ok` after every command. `workflow.patch` also requires `result.validation.valid`. `workflow.validate` requires `result.valid`.

## Settings to fill

| What | Exact place | Notes |
| --- | --- | --- |
| Draft id | `create.json` `id`, then the same `id` in later requests | Shipped value is `research-trio`. |
| Researcher 1 model/thinking | `patch.json` node `researcher-1` / `investigate` / `config` | `model.provider`, `model.id`, `thinking`. |
| Researcher 2 model/thinking | `patch.json` node `researcher-2` / `investigate` / `config` | Same fields; may differ from the other nodes. |
| Researcher 3 model/thinking | `patch.json` node `researcher-3` / `investigate` / `config` | Same fields; may differ from the other nodes. |
| Synthesizer model/thinking | `patch.json` node `main` / `aggregate` / `config` | Same fields; may differ from the researchers. |
| Question, criteria, sources, r1/r2/r3 assignments, synthesis assignment | `input.json` | Each branch receives shared `question`/`criteria`/`sources` plus only its own assignment. |
| Workspace | `workflow.prepare` `cwd` | Directory that contains the local sources you listed. |
| Journal | `--store` on every command | Absolute path if you leave this cwd. |

`thinking: "high"` in the shipped patch is a syntactically valid example, not a claim that your selected model supports it. After `catalog.models` and `catalog.describe`, replace provider, model id and thinking on all four configs with values from the current catalog. Historical Grok IDs in repository docs are not proof of availability. An unfilled or unavailable model/thinking fails `workflow.prepare`; it does not fall back.

Do not add retry policies, output-repair policies, concurrency caps, iteration/time limits or approval gates to this recipe.

## Catalog, then author, then prepare

```sh
dynamicwf catalog.models --store "$STORE" <<'JSON'
{}
JSON

dynamicwf catalog.describe --store "$STORE" <<'JSON'
{"name":"researcher"}
JSON

dynamicwf catalog.describe --store "$STORE" <<'JSON'
{"name":"synthesizer"}
JSON
```

Edit the four `config` objects and `input.json`, then:

```sh
dynamicwf workflow.create --store "$STORE" < create.json > create-response.json
node -e 'const e=JSON.parse(require("node:fs").readFileSync("create-response.json","utf8")); if(!e.ok) throw new Error(e.error.message); process.stdout.write("revision "+e.result.revision+"\n");'

node -e 'const fs=require("node:fs"); const created=JSON.parse(fs.readFileSync("create-response.json","utf8")); if(!created.ok) throw new Error(created.error.message); const patch=JSON.parse(fs.readFileSync("patch.json","utf8")); patch.expectedRevision=created.result.revision; fs.writeFileSync("patch.live.json", JSON.stringify(patch));'
dynamicwf workflow.patch --store "$STORE" < patch.live.json > patch-response.json
node -e 'const e=JSON.parse(require("node:fs").readFileSync("patch-response.json","utf8")); if(!e.ok) throw new Error(e.error.message); if(!e.result.validation.valid) throw new Error(JSON.stringify(e.result.validation)); process.stdout.write("revision "+e.result.workflow.revision+"\n");'
```

A new draft is usually revision `1`. Do not resend `patch.json` with a stale `expectedRevision`. If create returned another value, or you already patched, take `result.revision` / `result.workflow.revision` (or `workflow.inspect`) and rebase; a conflict means inspect the draft instead of forcing the old patch.

```sh
dynamicwf workflow.validate --store "$STORE" <<'JSON'
{"id":"research-trio"}
JSON
```

Confirm `ok` and `result.valid`. Then prepare the workspace that holds the sources (this cwd in the example):

```sh
node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({id:"research-trio",cwd:process.cwd()}));' | dynamicwf workflow.prepare --store "$STORE" > prepare-response.json
node -e 'const e=JSON.parse(require("node:fs").readFileSync("prepare-response.json","utf8")); if(!e.ok) throw new Error(e.error.message); process.stdout.write(e.result.preparedId+"\n"+e.result.planHash+"\n");'
```

Inspect `prepare-response.json` `result.plan`: four distinct chosen models/thinking, `session:"fresh"`, `permission:"read-only"`, tools `read`/`grep`/`find`/`ls`. `workflow.prepared {"preparedId":"..."}` rereads the same handle from this journal.

## Start from the prepared handle

Choose a stable `idempotencyKey` before sending. Save a start request that contains only `preparedId` from the prepare result, `input`, and that key. Do not use the draft-id start shortcut. Do not add `cwd` or `model` on top of `preparedId`.

```sh
node -e 'const fs=require("node:fs"); const prep=JSON.parse(fs.readFileSync("prepare-response.json","utf8")); if(!prep.ok) throw new Error(prep.error.message); const request={preparedId:prep.result.preparedId,idempotencyKey:"research-trio-attempt-1",input:JSON.parse(fs.readFileSync("input.json","utf8"))}; fs.writeFileSync("start-request.json", JSON.stringify(request));'
dynamicwf run.start --store "$STORE" < start-request.json > start-response.json
node -e 'const fs=require("node:fs"); const start=JSON.parse(fs.readFileSync("start-response.json","utf8")); if(!start.ok) throw new Error(start.error.message); const id=start.result.id; const store=process.argv[1]; const q=s=>"\x27"+String(s).replace(/\x27/g,"\x27\\\x27\x27")+"\x27"; process.stdout.write(id+"\n"); process.stdout.write("dynamicwf watch --run "+q(id)+" --store "+q(store)+"\n");' "$STORE"
```

Print the real `result.id` and that quoted watch command immediately, before waiting for completion. A lost response is retried with the unchanged `start-request.json`. A new intended run needs a new key and a new start-request file.

```sh
node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({id:JSON.parse(fs.readFileSync("start-response.json","utf8")).result.id}));' | dynamicwf run.status --store "$STORE"
node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({id:JSON.parse(fs.readFileSync("start-response.json","utf8")).result.id}));' | dynamicwf run.inspect --store "$STORE"
```

Technical `succeeded` means the graph finished. Read `taskOutcome.decision`, `reason` and `evidence`. `accepted` requires three succeeded collect envelopes, three `complete` researcher reports, and a synthesizer `accepted` that still passes the finish guard. A failed branch, an `inconclusive` report, or an `inconclusive` synthesis finishes `inconclusive`. If the synthesizer itself fails, the run stays `failed` and the collected envelopes remain in the journal. Do not save a preset in this ordinary sequence.

## Result

`main.research` is `parallel`/`collect` children `r1`/`r2`/`r3` on graphs `researcher-1`/`researcher-2`/`researcher-3`. Each child graph is an independent fresh read-only researcher plus `end`. `main.aggregate` is a separate synthesizer. A conditional edge goes to finish `accepted`; the fallback is finish `inconclusive`. Researcher output is `decision` (`complete`|`inconclusive`), `summary`, `findings`, `evidence`, `uncertainties`. Synthesizer output is `decision` (`accepted`|`inconclusive`), `summary`, `reason`, `evidence`, `disagreements`, `uncertainties`. The finish `value` repeats `decision`/`accepted` from the chosen finish node and keeps the raw named reports plus the synthesis object. The synthesis verdict is data, not a bypass of the guard.
