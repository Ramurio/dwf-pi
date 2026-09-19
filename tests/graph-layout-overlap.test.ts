import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error browser-native module
import { layoutGraph } from "../src/graph-view/layout.js";

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
const segments = (points: Point[]) => points.slice(1).map((b, i) => [points[i]!, b] as const)
  .filter(([a, b]) => a.x !== b.x || a.y !== b.y);
function overlap([a, b]: readonly Point[], [c, d]: readonly Point[]) {
  if (a!.x === b!.x && c!.x === d!.x && a!.x === c!.x)
    return Math.max(0, Math.min(Math.max(a!.y, b!.y), Math.max(c!.y, d!.y)) - Math.max(Math.min(a!.y, b!.y), Math.min(c!.y, d!.y)));
  if (a!.y === b!.y && c!.y === d!.y && a!.y === c!.y)
    return Math.max(0, Math.min(Math.max(a!.x, b!.x), Math.max(c!.x, d!.x)) - Math.max(Math.min(a!.x, b!.x), Math.min(c!.x, d!.x)));
  return 0;
}
const hits = ([a, b]: readonly Point[], box: Box) => a!.x === b!.x
  ? a!.x > box.x && a!.x < box.x + box.width && Math.max(a!.y, b!.y) > box.y && Math.min(a!.y, b!.y) < box.y + box.height
  : a!.y > box.y && a!.y < box.y + box.height && Math.max(a!.x, b!.x) > box.x && Math.min(a!.x, b!.x) < box.x + box.width;
const disjoint = (a: Box, b: Box) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const graph = (ids: string[], pairs: string[][]) => ({ entry: ids[0], nodes: ids.map(id => ({ id })), edges: pairs.map(([from, to]) => ({ from, to, conditional: true })) });
const fixtures = [
  graph(["a", "b", "c", "d"], [["a", "d"], ["a", "c"], ["b", "c"], ["b", "d"]]),
  graph(["a", "b"], Array.from({ length: 16 }, () => ["a", "b"])),
  graph(["a", "b", "c", "d", "unused"], [["a", "b"], ["a", "c"], ["b", "c"], ["c", "b"], ["c", "d"], ["d", "a"], ["b", "b"]]),
  ...[4, 12, 30].map(n => {
    const children = Array.from({ length: n }, (_, i) => `c${i}`);
    return graph(["start", ...children, "join", "unused"], [...children.map(c => ["start", c]), ...children.map(c => [c, "join"]), ["join", "start"], ["join", "join"]]);
  }),
];
test("overlap metric ignores zero segments and point crossings", () => {
  assert.equal(segments([{ x: 0, y: 0 }, { x: 0, y: 0 }]).length, 0);
  assert.equal(overlap([{ x: 0, y: 0 }, { x: 0, y: 10 }], [{ x: -5, y: 5 }, { x: 5, y: 5 }]), 0);
  assert.equal(overlap([{ x: 0, y: 0 }, { x: 0, y: 10 }], [{ x: 0, y: 10 }, { x: 0, y: 20 }]), 0);
  assert.equal(overlap([{ x: 0, y: 0 }, { x: 0, y: 10 }], [{ x: 0, y: 12 }, { x: 0, y: 4 }]), 6);
});
for (const [index, fixture] of fixtures.entries()) test(`actual layout: no shared segments or occluding masks, fixture ${index}`, () => {
  const layout = layoutGraph(fixture);
  assert.deepEqual(layoutGraph(fixture), layout);
  assert.deepEqual(layoutGraph({ ...fixture, nodes: fixture.nodes.map(n => ({ ...n, status: "running" })) }), layout);
  assert.equal(layout.positions.size, fixture.nodes.length);
  for (const [i, edge] of layout.edges.entries()) {
    assert.equal(edge.index, i);
    assert.equal(edge.order, fixture.edges.slice(0, i + 1).filter(e => e.from === edge.from).length);
    assert.equal(edge.from, fixture.edges[i]!.from);
    assert.equal(edge.to, fixture.edges[i]!.to);
    const from = layout.positions.get(edge.from), to = layout.positions.get(edge.to);
    assert.equal(edge.points[0].y, from.y + from.height);
    assert.equal(edge.points.at(-1).y, to.y);
    for (const [point, box] of [[edge.points[0], from], [edge.points.at(-1), to]]) assert.ok(point.x > box.x && point.x < box.x + box.width);
    for (const p of edge.points) assert.ok(p.x >= 0 && p.y >= 0 && p.x <= layout.width && p.y <= layout.height);
    assert.doesNotMatch(edge.path, /NaN|Infinity|undefined/);
    for (const s of segments(edge.points)) {
      assert.ok(s[0].x === s[1].x || s[0].y === s[1].y);
      for (const box of layout.positions.values()) assert.ok(!hits(s, box));
      for (const other of layout.edges.slice(i + 1)) for (const t of segments(other.points)) assert.equal(overlap(s, t), 0, `${i}/${other.index}`);
    }
    const label = edge.labelBox;
    assert.ok(label.x >= 0 && label.y >= 0 && label.x + label.width <= layout.width && label.y + label.height <= layout.height);
    for (const box of layout.positions.values()) assert.ok(disjoint(label, box));
    for (const other of layout.edges) if (other !== edge) {
      assert.ok(disjoint(label, other.labelBox));
      for (const s of segments(other.points)) assert.ok(!hits(s, label), `mask ${i} hides ${other.index}`);
      if (other.from === edge.from) assert.notEqual(other.points[0].x, edge.points[0].x);
      if (other.to === edge.to) assert.notEqual(other.points.at(-1).x, edge.points.at(-1).x);
    }
  }
  if (index === 0) assert.deepEqual(layout.edges.map((e: any) => [e.fromRank, e.toRank, e.loop]), Array(4).fill([0, 1, false]));
  if (index === 2) assert.deepEqual(layout.edges.map((e: any) => e.loop), [false, false, false, true, false, true, true]);
});
