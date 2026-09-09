import assert from "node:assert/strict";
import test from "node:test";
import { get as httpGet } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RunStore,
  activationKey,
  type ActivationRecord,
} from "../src/run-store.js";
import { RunController } from "../src/run-controller.js";
import { prepareExecutionPlan } from "../src/execution-plan.js";
import { startGraphServer } from "../src/graph-view/server.js";
import { graphSnapshot } from "../src/graph-view/model.js";
import type { WorkflowDefinition } from "../src/graph.js";
// The layout module is browser-native JavaScript, also executed here for graph invariants.
// @ts-expect-error browser module has no declaration file
import { layoutGraph } from "../src/graph-view/layout.js";
const flow: WorkflowDefinition = {
  schemaVersion: 1,
  id: "ui-test",
  name: "UI <script>do_not_run()</script>",
  revision: 1,
  entryGraph: "main",
  graphs: {
    main: {
      entry: "done",
      nodes: [
        {
          id: "done",
          kind: "end",
          value: { op: "literal", value: { accepted: true } },
        },
      ],
      edges: [],
    },
  },
};
async function fixture(
  work: (f: {
    store: RunStore;
    filename: string;
    directory: string;
    url: string;
    close: () => Promise<void>;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "dynamicwf-ui-")),
    filename = join(directory, "state.sqlite"),
    store = new RunStore(filename);
  const plan = await prepareExecutionPlan(flow, {
    cwd: directory,
    availableModels: [],
  });
  store.create({
    id: "run-ui",
    plan,
    input: { secret: "INPUT_NOT_FOR_THE_BROWSER" },
    cwd: directory,
  });
  const server = await startGraphServer(filename, "run-ui");
  try {
    await work({ store, filename, directory, ...server });
  } finally {
    await server.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const headers = (url: string) => ({
  Origin: new URL(url).origin,
  "Content-Type": "application/json",
  "X-Dynamicwf-View": "1",
});

test("local UI serves all assets and a safe projection; read-only requests preserve journal events", async () =>
  fixture(async (f) => {
    const before = f.store.events("run-ui");
    for (const name of ["", "app.js", "layout.js", "style.css"]) {
      const response = await fetch(f.url + name);
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-security-policy")!,
        /frame-ancestors 'none'/,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const snapshot = await (await fetch(f.url + "snapshot?id=run-ui")).json();
    assert.equal(snapshot.id, "run-ui");
    assert.equal(snapshot.graphs[0].nodes[0].status, "unvisited");
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /INPUT_NOT_FOR_THE_BROWSER|ownerToken|systemPrompt|sourceHash/,
    );
    assert.equal((await (await fetch(f.url + "runs")).json()).runs.length, 1);
    assert.deepEqual(f.store.events("run-ui"), before);
  }));

test("control refuses missing token, external Host/Origin, unknown verbs and oversized bodies", async () =>
  fixture(async (f) => {
    const body = JSON.stringify({ id: "run-ui", command: "pause" });
    assert.equal((await fetch(new URL("/runs", f.url))).status, 404);
    const wrongHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        httpGet(
          f.url + "runs",
          { headers: { Host: "other.invalid" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      },
    );
    assert.equal(wrongHost, 403);
    for (const h of [
      { "Content-Type": "application/json" },
      { ...headers(f.url), Origin: "https://other.invalid" },
    ]) {
      assert.equal(
        (await fetch(f.url + "control", { method: "POST", headers: h, body }))
          .status,
        403,
      );
    }
    assert.equal(
      (
        await fetch(f.url + "control", {
          method: "POST",
          headers: headers(f.url),
          body: JSON.stringify({ id: "run-ui", command: "delete" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(f.url + "control", {
          method: "POST",
          headers: headers(f.url),
          body: JSON.stringify({ id: "x".repeat(5000), command: "pause" }),
        })
      ).status,
      400,
    );
    assert.equal(f.store.get("run-ui").status, "queued");
  }));

test(
  "browser controls pause, resume a real pure workflow, observe completion, and cancel a separate queued run",
  { timeout: 15_000 },
  async () =>
    fixture(async (f) => {
      const post = async (id: string, command: string) => {
        const response = await fetch(f.url + "control", {
          method: "POST",
          headers: headers(f.url),
          body: JSON.stringify({ id, command }),
        });
        assert.equal(response.status, 200, await response.text());
      };
      await post("run-ui", "pause");
      assert.equal(f.store.get("run-ui").status, "paused");
      const controller = new RunController(f.filename);
      try {
        await post("run-ui", "resume");
        const deadline = Date.now() + 10_000;
        while (
          f.store.get("run-ui").status !== "succeeded" &&
          Date.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(f.store.get("run-ui").status, "succeeded");
        const result = await (await fetch(f.url + "snapshot?id=run-ui")).json();
        assert.equal(result.accepted, true);
        assert.equal(result.graphs[0].nodes[0].activations.length, 1);
        f.store.create({
          id: "run-cancel",
          plan: f.store.get("run-ui").plan,
          input: null,
          cwd: f.directory,
        });
        await post("run-cancel", "cancel");
        assert.equal(f.store.get("run-cancel").status, "cancelled");
      } finally {
        if (f.store.get("run-ui").status !== "succeeded")
          await controller.control("run-ui", "cancel");
        controller.close();
      }
    }),
);

test("node projection distinguishes branches and visits, reports tokens once and excludes worker identities", async () =>
  fixture(async (f) => {
    const run = f.store.get("run-ui");
    run.plan.workflow.graphs.main!.nodes = [
      {
        id: "review",
        kind: "agent",
        role: "reviewer",
        task: { op: "literal", value: "PRIVATE_PROMPT" },
      },
    ];
    const records: ActivationRecord[] = ["left", "right"].map(
      (branch, index) => {
        const context = {
          graphId: "main",
          nodeId: "review",
          scope: [
            "graph",
            "main",
            "node",
            "fork",
            "visit",
            "0",
            "parallel",
            branch,
            "graph",
            "child",
          ],
          visit: index,
        };
        return {
          runId: run.id,
          key: activationKey(context),
          context,
          kind: "agent",
          sideEffect: true,
          status: "succeeded",
          attempt: 1,
          ownerToken: "OWNER_SECRET",
          startedAt: index + 1,
          finishedAt: index + 2,
          output: { decision: "approve" },
          metadata: {
            workerToken: "WORKER_SECRET",
            sessionFile: "PRIVATE_SESSION",
            usage: { input: 10, output: 20, totalTokens: 50 },
          },
        };
      },
    );
    const snapshot = graphSnapshot(run, records),
      node = snapshot.graphs[0]!.nodes[0]!;
    assert.equal(node.branches, 2);
    assert.equal(node.usage.totalTokens, 100);
    assert.equal(node.activations[0]!.visit, 2);
    assert.equal(node.activations[0]!.result, "approve");
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /OWNER_SECRET|WORKER_SECRET|PRIVATE_PROMPT|PRIVATE_SESSION/,
    );
  }));

test("layout preserves branching, cycles, self-loops and disconnected nodes without overlapping cards", () => {
  const graph = {
    entry: "a",
    nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "a" },
      { from: "c", to: "c" },
    ],
  };
  const layout = layoutGraph(graph);
  assert.equal(layout.positions.size, 4);
  assert.equal(layout.edges.length, 4);
  assert.equal(layout.edges.filter((e: { loop: boolean }) => e.loop).length, 2);
  const boxes = [...layout.positions.values()] as Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      );
});

test("cross-layer edges in an acyclic graph are not mislabeled as repeated execution", () => {
  const graph = {
    entry: "a",
    nodes: ["a", "b", "c"].map((id) => ({ id })),
    edges: [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ],
  };
  assert.equal(
    layoutGraph(graph).edges.filter((edge: { loop: boolean }) => edge.loop)
      .length,
    0,
  );
});
