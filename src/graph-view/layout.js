/** Deterministic orthogonal routes. Geometry depends only on the frozen graph, never on live status. */
export function layoutGraph(graph) {
  const outgoing = new Map(graph.nodes.map(n => [n.id, []]));
  const incoming = new Map(graph.nodes.map(n => [n.id, []]));
  const edges = graph.edges.map((edge, index) => {
    const item = { ...edge, index, order: outgoing.get(edge.from).length + 1 };
    outgoing.get(edge.from).push(item);
    incoming.get(edge.to).push(item);
    return item;
  });
  // Identify return edges with a deterministic DFS, then rank the remaining DAG.
  // Shortcuts must not pull later stages into the same row and turn ordinary
  // forward edges inside a repair loop into apparent returns.
  const color = new Map();
  for (const root of [graph.entry, ...graph.nodes.map(n => n.id)]) {
    if (color.has(root)) continue;
    color.set(root, 1);
    const stack = [{ id: root, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1), next = outgoing.get(frame.id)[frame.next++];
      if (!next) { color.set(frame.id, 2); stack.pop(); continue; }
      next.loop = color.get(next.to) === 1;
      if (!color.has(next.to)) { color.set(next.to, 1); stack.push({ id: next.to, next: 0 }); }
    }
  }
  const rank = new Map(graph.nodes.map(n => [n.id, 0]));
  const degree = new Map(graph.nodes.map(n => [n.id, incoming.get(n.id).filter(e => !e.loop).length]));
  const queue = graph.nodes.filter(n => degree.get(n.id) === 0).map(n => n.id);
  for (let i = 0; i < queue.length; i++) for (const edge of outgoing.get(queue[i])) {
    if (edge.loop) continue;
    rank.set(edge.to, Math.max(rank.get(edge.to), rank.get(edge.from) + 1));
    degree.set(edge.to, degree.get(edge.to) - 1);
    if (degree.get(edge.to) === 0) queue.push(edge.to);
  }
  const layers = new Map();
  for (const node of graph.nodes) {
    const level = rank.get(node.id);
    layers.set(level, [...(layers.get(level) ?? []), node]);
  }
  // Reserve distinct horizontal tracks in the gaps between rows. Long/return edges
  // use a second track above their target and a unique lane outside the entire stack.
  const tracks = new Map();
  const track = (gap) => {
    const index = tracks.get(gap) ?? 0;
    tracks.set(gap, index + 1);
    return index;
  };
  let outerCount = 0;
  for (const edge of edges) {
    edge.fromRank = rank.get(edge.from);
    edge.toRank = rank.get(edge.to);
    edge.exitTrack = track(edge.fromRank);
    edge.external = edge.toRank !== edge.fromRank + 1;
    if (edge.external) { edge.entryTrack = track(edge.toRank - 1); edge.outerLane = outerCount++; }
  }
  const nodeWidth = (id) => Math.max(230, 48 + (Math.max(outgoing.get(id).length, incoming.get(id).length) - 1) * 16);
  const layerWidth = nodes => nodes.reduce((sum, n) => sum + nodeWidth(n.id), 0) + (nodes.length - 1) * 48;
  const stackWidth = Math.max(280, ...[...layers.values()].map(layerWidth));
  const positions = new Map(), gapStarts = new Map([[-1, 0]]);
  let y = Math.max(60, 64 + (tracks.get(-1) ?? 0) * 28);
  for (const [level, nodes] of [...layers].sort((a, b) => a[0] - b[0])) {
    let x = 48 + (stackWidth - layerWidth(nodes)) / 2;
    for (const node of nodes) {
      const width = nodeWidth(node.id);
      positions.set(node.id, { x, y, width, height: 104 });
      x += width + 48;
    }
    gapStarts.set(level, y + 104);
    y += 104 + Math.max(80, 64 + (tracks.get(level) ?? 0) * 28);
  }
  const port = (id, edge, list) => {
    const box = positions.get(id);
    // Sort by peer position to reduce crossings; retain original order as a stable tie-breaker.
    const sorted = [...list].sort((a, b) => {
      const peerA = positions.get(a.from === id ? a.to : a.from);
      const peerB = positions.get(b.from === id ? b.to : b.from);
      return peerA.x - peerB.x || a.index - b.index;
    });
    return box.x + box.width / 2 + (sorted.indexOf(edge) - (list.length - 1) / 2) * 16;
  };
  const routed = edges.map(edge => {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    const x1 = port(edge.from, edge, outgoing.get(edge.from));
    const x2 = port(edge.to, edge, incoming.get(edge.to));
    const exitY = gapStarts.get(edge.fromRank) + 32 + edge.exitTrack * 28;
    const points = [{ x: x1, y: from.y + from.height }, { x: x1, y: exitY }];
    if (edge.external) {
      const side = 48 + stackWidth + 40 + edge.outerLane * 28;
      const entryY = gapStarts.get(edge.toRank - 1) + 32 + edge.entryTrack * 28;
      points.push({ x: side, y: exitY }, { x: side, y: entryY }, { x: x2, y: entryY });
    } else points.push({ x: x2, y: exitY });
    points.push({ x: x2, y: to.y });
    const duplicates = outgoing.get(edge.from).filter(e => e.to === edge.to).length > 1;
    const label = edge.loop ? `повтор · ${edge.order}` : edge.conditional ? `условие · ${edge.order}` : duplicates ? `иначе · ${edge.order}` : "";
    const width = label.length * 7.5 + 16;
    const endX = points[2].x;
    const labelX = Math.abs(endX - x1) >= width + 16 ? (x1 + endX - width) / 2 : Math.min(x1, endX) + 14;
    const labelBox = { x: labelX, y: exitY - 24, width, height: 18 };
    return { ...edge, points, path: roundedPath(points), label, labelBox,
      labelX: labelBox.x + 8, labelY: labelBox.y + 13 };
  });
  return {
    width: Math.max(48 + stackWidth + 48 + outerCount * 28,
      ...routed.filter(e => e.label).map(e => e.labelBox.x + e.labelBox.width + 48)),
    height: y + 32, positions, edges: routed,
  };
}

function roundedPath(points) {
  const p = points.filter((point, i) => !i || point.x !== points[i - 1].x || point.y !== points[i - 1].y);
  let path = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const before = p[i - 1], at = p[i], after = p[i + 1];
    const a = Math.hypot(at.x - before.x, at.y - before.y), b = Math.hypot(after.x - at.x, after.y - at.y);
    const radius = Math.min(8, a / 2, b / 2);
    path += ` L ${at.x - (at.x - before.x) / a * radius} ${at.y - (at.y - before.y) / a * radius}`;
    path += ` Q ${at.x} ${at.y} ${at.x + (after.x - at.x) / b * radius} ${at.y + (after.y - at.y) / b * radius}`;
  }
  return path + ` L ${p.at(-1).x} ${p.at(-1).y}`;
}
