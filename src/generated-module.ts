import { createHash } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import type { Effect } from "effect";
import type { ExecutionPlan } from "./execution-types.js";
import type { Json } from "./graph.js";
import type { WorkflowRuntime } from "./runtime-contract.js";

/** Resolve only compiler-owned imports; authored strings are never treated as module names. */
export async function loadGeneratedModule(plan: ExecutionPlan, directory: string): Promise<{
  run(runtime: WorkflowRuntime, input: Json): Effect.Effect<Json, Error>;
}> {
  if (createHash("sha256").update(plan.source).digest("hex") !== plan.sourceHash) throw new Error("Generated source hash mismatch");
  const modules: Record<string, string> = {
    effect: import.meta.resolve("effect"),
    "dynamicwf-pi/expressions": new URL("./expressions.ts", import.meta.url).href,
  };
  const compiled = ts.transpileModule(plan.source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false },
    transformers: { before: [context => source => ts.visitNode(source, function visitor(node: ts.Node): ts.VisitResult<ts.Node> {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
        const replacement = modules[node.moduleSpecifier.text];
        if (!replacement) throw new Error(`Unrecognized generated import: ${node.moduleSpecifier.text}`);
        return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause,
          ts.factory.createStringLiteral(replacement), node.attributes);
      }
      return ts.visitEachChild(node, visitor, context);
    }) as ts.SourceFile] },
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, `program-${plan.sourceHash}.mjs`);
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, compiled.outputText, { mode: 0o600 });
  await rename(temporary, filename);
  const loaded = await import(pathToFileURL(filename).href) as { run?: unknown };
  if (typeof loaded.run !== "function") throw new Error("Compiled module does not export run");
  return loaded as { run(runtime: WorkflowRuntime, input: Json): Effect.Effect<Json, Error> };
}
