import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Deferred, Effect } from "effect";
import { applyPatch, createDraft, PublicDraftPatchSchema } from "../src/authoring.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { createOutputValidator } from "../src/output-schema.js";
import { loadGeneratedModule } from "../src/generated-module.js";
import { JournalRuntime } from "../src/run-runtime.js";
import { RunStore } from "../src/run-store.js";
import type { Json } from "../src/graph.js";
import type { RuntimeContext } from "../src/runtime-contract.js";

const recipe = new URL("../skills/dynamic-workflows/recipes/parallel-reports/", import.meta.url);
const json = async (name: string) => JSON.parse(await readFile(new URL(name, recipe), "utf8"));
const model = { provider: "fixture", id: "reports", thinkingLevels: ["high"] as const };
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=Recipe test", "-c", "user.email=test@localhost",
    "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args],
  { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function author(bind = true) {
  const create = await json("create.json"), patch = await json("patch.json");
  createOutputValidator(PublicDraftPatchSchema)(patch);
  assert.equal(patch.id, create.id);
  if (bind) for (const operation of patch.operations) {
    if (operation.op === "addNode" && operation.node.kind === "agent") {
      operation.node.config.model = { provider: model.provider, id: model.id };
    }
  }
  const draft = createDraft(create);
  const result = applyPatch(draft, { expectedRevision: draft.revision, operations: patch.operations });
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation));
  return result.workflow;
}

test("parallel-reports: публичная схема, редактирование и подготовка без подмены модели", async () => {
  const unbound = await author(false);
  await assert.rejects(prepareExecutionPlan(unbound, { cwd: process.cwd(), availableModels: [model] }), /Model unavailable/);
  const plan = await prepareExecutionPlan(await author(), { cwd: process.cwd(), availableModels: [model] });
  assert.equal(plan.agents.writer!.research!.permission, "workspace-write");
  assert.deepEqual(plan.agents.writer!.research!.tools, ["read", "grep", "find", "ls", "write"]);
  assert.equal(plan.agents.main!.synthesize!.permission, "read-only");
  assert.equal(Object.values(plan.workflow.graphs).flatMap(g => g.nodes).some(n => n.kind === "integrate"), false);
});

for (const scenario of ["different-paths", "same-path", "failed-branch"] as const) {
  test(`parallel-reports: реальные отчёты, изоляция и оболочки (${scenario})`, { timeout: 30000 }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "parallel-reports-")));
    const repo = join(directory, "repo"); await mkdir(repo);
    git(repo, "init", "-b", "main");
    await writeFile(join(repo, "source.txt"), "Источник для двух независимых отчётов.\n");
    git(repo, "add", "."); git(repo, "commit", "-m", "Проверочные источники");
    const base = git(repo, "rev-parse", "HEAD");
    const input = await json("input.json");
    input.sources = ["source.txt"];
    input.projectPolicy = "Пиши только свой отчёт внутри выделенного рабочего дерева.";
    input.first.assignment = "FIRST_ONLY"; input.second.assignment = "SECOND_ONLY";
    if (scenario === "same-path") input.first.reportPath = input.second.reportPath = "reports/shared.md";
    const plan = await prepareExecutionPlan(await author(), { cwd: repo, availableModels: [model] });
    const store = new RunStore(join(directory, "state.sqlite"));
    t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
    store.create({ id: "run-reports", plan, input, cwd: repo });
    const { run, token } = store.reserveLaunch("run-reports");
    const runtime = new JournalRuntime(store, run, token, join(directory, "run"));
    const entered: string[] = [], bothEntered = await Effect.runPromise(Deferred.make<void>());
    let synthesisInput: any;
    // Заменяем только модельные ответы. Компилятор, журнал, collect, Git-выделение,
    // выбор cwd и фиксация отчётов остаются настоящими. Барьер доказывает параллелизм.
    runtime.agent = (context, node, _task, supplied) => Effect.gen(function* () {
      const value = supplied as any;
      if (node.role === "researcher") {
        assert.deepEqual(Object.keys(value).sort(), ["assignment", "criteria", "projectPolicy", "question", "reportPath", "sources"]);
        assert.deepEqual(value.sources, ["source.txt"]);
        assert.deepEqual(value.criteria, input.criteria);
        entered.push(value.assignment);
        if (entered.length === 2) yield* Deferred.succeed(bothEntered, undefined);
        yield* Deferred.await(bothEntered);
        if (scenario === "failed-branch" && value.assignment === "FIRST_ONLY") {
          return yield* Effect.fail(new Error("Проверочный отказ первой ветви"));
        }
        const result = { status: "written", reportPath: value.reportPath, summary: value.assignment };
        // Подставной агент использует тот же выбор cwd, что и настоящий worker.
        // Приватная граница читается только здесь; Git-выделение/журнал не подменены.
        const cwd = (runtime as unknown as { workspaceCwd(c: RuntimeContext): string }).workspaceCwd(context);
        assert.notEqual(cwd, repo);
        yield* Effect.tryPromise(async () => {
          assert.match(await readFile(join(cwd, "source.txt"), "utf8"), /Источник/);
          await mkdir(dirname(join(cwd, value.reportPath)), { recursive: true });
          await writeFile(join(cwd, value.reportPath), value.assignment + "\n");
        });
        const output = result;
        return createOutputValidator(plan.agents[context.graphId]![node.id]!.outputSchema)(output);
      }
      assert.equal(node.role, "synthesizer");
      synthesisInput = value;
      assert.deepEqual(entered.sort(), ["FIRST_ONLY", "SECOND_ONLY"]);
      const worktrees = store.listActivations(run.id).filter(a => a.kind === "worktree");
      assert.equal(worktrees.length, 2);
      assert.ok(worktrees.every(a => a.status === "succeeded" || a.status === "failed"), "Обобщение начинается после всех ветвей");
      for (const name of ["first", "second"]) {
        const report = value.reports[name];
        if (report.status === "failed") { assert.equal(Object.hasOwn(report, "value"), false); continue; }
        assert.deepEqual(Object.keys(report.value).sort(), ["result", "workspace"]);
        const { result, workspace } = report.value;
        assert.equal(workspace.base, base); assert.notEqual(workspace.path, repo);
        assert.equal(workspace.head, git(workspace.path, "rev-parse", "HEAD"));
        assert.equal(git(workspace.path, "status", "--porcelain"), "");
        const contents = yield* Effect.promise(() => readFile(join(workspace.path, result.reportPath), "utf8"));
        assert.equal(contents, input[name].assignment + "\n");
        assert.equal(git(workspace.path, "show", `${workspace.head}:${result.reportPath}`), input[name].assignment);
      }
      // Намеренно ошибочное одобрение в failed-branch: корневой guard обязан отказать.
      return { decision: "accepted", summary: "Проверочные отчёты собраны", reason: "Ответ подставного обобщающего агента" };
    });
    const module = await loadGeneratedModule(plan, join(directory, "generated"));
    const output: any = await Effect.runPromise(module.run(runtime, input as Json));
    store.finish(run.id, token, { status: "succeeded", output });
    assert.deepEqual(output.reports, synthesisInput.reports);
    assert.deepEqual(Object.keys(output).sort(), ["reports", "synthesis"]);
    assert.equal(store.get(run.id).taskOutcome?.decision, scenario === "failed-branch" ? "inconclusive" : "accepted", JSON.stringify(output));
    assert.equal(git(repo, "rev-parse", "HEAD"), base);
    assert.equal(git(repo, "status", "--porcelain"), "");
    await assert.rejects(readFile(join(repo, input.first.reportPath)), { code: "ENOENT" });
    if (scenario === "failed-branch") {
      assert.equal(output.reports.first.status, "failed");
      assert.equal(output.reports.second.status, "succeeded");
      assert.match(output.reports.first.failure.message, /Проверочный отказ/);
    } else {
      const a = output.reports.first.value, b = output.reports.second.value;
      assert.notEqual(a.workspace.path, b.workspace.path);
      assert.notEqual(a.workspace.branch, b.workspace.branch);
      assert.notEqual(a.workspace.head, b.workspace.head);
      if (scenario === "different-paths") {
        await assert.rejects(readFile(join(a.workspace.path, b.result.reportPath)), { code: "ENOENT" });
        await assert.rejects(readFile(join(b.workspace.path, a.result.reportPath)), { code: "ENOENT" });
      }
    }
  });
}
