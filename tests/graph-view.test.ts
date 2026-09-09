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

test("browser receives live response usage and a cursor ledger without private owner tokens", async () => {
  await fixture(async ({ store, url }) => {
    const { token } = store.reserveLaunch("run-ui");
    const context = { scope: ["graph", "main"], graphId: "main", nodeId: "done", visit: 0 };
    const key = activationKey(context);
    store.beginActivation("run-ui", token, context, { kind: "agent", sideEffect: true });
    store.startUsage("run-ui", token, key);
    store.recordUsage("run-ui", token, key, "1", { input: 10, output: 3, cacheRead: 20, cacheWrite: 0, totalTokens: 33 }, "toolUse");
    const response = await fetch(`${url}usage?id=run-ui`);
    assert.equal(response.status, 200);
    const page = await response.json() as any;
    assert.equal(page.reports[0].usage.cacheRead, 20);
    assert.equal(page.reports[0].usage.totalTokens, 33);
    assert.doesNotMatch(JSON.stringify(page), new RegExp(token));
    const next = await (await fetch(`${url}usage?id=run-ui&after=${page.nextAfter}`)).json() as any;
    assert.equal(next.reports.length, 0);
    assert.equal((await fetch(`${url}usage?id=run-ui&after=-1`)).status, 400);
  });
});
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
    for (const name of ["", "app.js", "layout.js", "usage-pages.js", "style.css"]) {
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

test("parallel conditions get separate ports, tracks and labels; status updates never move the graph", () => {
  const graph = { entry: "a", nodes: [{ id: "a" }, { id: "b" }], edges: [
    { from: "a", to: "b", conditional: true }, { from: "a", to: "b", conditional: true },
    { from: "a", to: "b", conditional: false },
  ] };
  const layout = layoutGraph(graph);
  assert.equal(new Set(layout.edges.map((e: any) => e.path)).size, 3);
  assert.equal(new Set(layout.edges.map((e: any) => e.points[0].x)).size, 3);
  assert.equal(new Set(layout.edges.map((e: any) => e.points.at(-1).x)).size, 3);
  assert.equal(new Set(layout.edges.map((e: any) => e.labelY)).size, 3);
  assert.deepEqual(layout.edges.map((e: any) => e.label), ["условие · 1", "условие · 2", "иначе · 3"]);
  assert.deepEqual(layoutGraph({ ...graph, nodes: graph.nodes.map(n => ({ ...n, status: "running", usage: { totalTokens: 100 } })) }), layout);
});

test("a shortcut does not turn the forward half of a repair loop into a return", () => {
  const graph = { entry: "plan", nodes: ["plan", "code", "review", "done"].map(id => ({ id })), edges: [
    { from: "plan", to: "code" }, { from: "plan", to: "review" }, { from: "code", to: "review" },
    { from: "review", to: "code" }, { from: "review", to: "done" },
  ] };
  const layout = layoutGraph(graph);
  assert.equal(layout.edges.find((e: any) => e.from === "code" && e.to === "review").loop, false);
  assert.equal(layout.edges.find((e: any) => e.from === "review" && e.to === "code").loop, true);
  assert.ok(layout.positions.get("review").y > layout.positions.get("code").y);
});

test("routes and label masks avoid every node across joins, dense fan-out, multiple cycles and disconnected scopes", () => {
  const graphs = [
    { entry: "a", nodes: ["a", "b", "c", "d", "unused"].map(id => ({ id })), edges: [
      { from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" },
      { from: "d", to: "a", conditional: true }, { from: "d", to: "b", conditional: true }, { from: "b", to: "b", conditional: true },
    ] },
    ...[1, 4, 12, 30].map(count => ({ entry: "start",
      nodes: ["start", ...Array.from({ length: count }, (_, i) => `child${i}`), "join"].map(id => ({ id })),
      edges: [...Array.from({ length: count }, (_, i) => ({ from: "start", to: `child${i}`, conditional: true })),
        ...Array.from({ length: count }, (_, i) => ({ from: `child${i}`, to: "join" })),
        { from: "join", to: "start", conditional: true }, { from: "join", to: "join", conditional: true }],
    })),
  ];
  for (const graph of graphs) {
    const layout = layoutGraph(graph);
    const labels = layout.edges.filter((e: any) => e.label).map((e: any) => e.labelBox);
    for (const edge of layout.edges) {
      assert.doesNotMatch(edge.path, /NaN|undefined|Infinity/);
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], b = edge.points[i];
        assert.ok(a.x === b.x || a.y === b.y, "routes must be orthogonal");
        for (const box of layout.positions.values()) {
          const crosses = a.x === b.x
            ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
            : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
          assert.equal(crosses, false, `${edge.from}→${edge.to} crosses a node`);
        }
      }
    }
    const disjoint = (a: any, b: any) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    for (const [i, label] of labels.entries()) {
      assert.ok(label.x >= 0 && label.y >= 0 && label.x + label.width <= layout.width && label.y + label.height <= layout.height);
      for (const box of layout.positions.values()) assert.ok(disjoint(label, box), "label must not overlap a node");
      for (const other of labels.slice(i + 1)) assert.ok(disjoint(label, other), "labels must not overlap");
    }
  }
});
