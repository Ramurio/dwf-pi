/** Cycle-safe layered layout. Arrow paths retain every declared edge, including return edges. */
export function layoutGraph(graph) {
  const rank = new Map([[graph.entry, 0]]),
    queue = [graph.entry];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of graph.edges.filter((e) => e.from === queue[i])) {
      if (!rank.has(edge.to)) {
        rank.set(edge.to, rank.get(edge.from) + 1);
        queue.push(edge.to);
      }
    }
  }
  let last = Math.max(0, ...rank.values());
  for (const node of graph.nodes)
    if (!rank.has(node.id)) rank.set(node.id, ++last);
  const layers = new Map();
  for (const node of graph.nodes) {
    const level = rank.get(node.id);
    layers.set(level, [...(layers.get(level) ?? []), node]);
  }
  const width = Math.max(
    380,
    ...[...layers.values()].map((nodes) => nodes.length * 275 + 100),
  );
  const positions = new Map();
  for (const [level, nodes] of layers)
    nodes.forEach((node, index) =>
      positions.set(node.id, {
        x: (width - nodes.length * 275) / 2 + index * 275,
        y: 50 + level * 160,
        width: 230,
        height: 104,
      }),
    );
  const reaches = (start, target) => {
    const seen = new Set(),
      pending = [start];
    while (pending.length) {
      const id = pending.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of graph.edges)
        if (edge.from === id) pending.push(edge.to);
    }
    return false;
  };
  const edges = graph.edges.map((edge, index) => {
    const from = positions.get(edge.from),
      to = positions.get(edge.to);
    const backward = rank.get(edge.to) <= rank.get(edge.from);
    const loop = backward && reaches(edge.to, edge.from);
    const x1 = from.x + from.width / 2,
      y1 = from.y + from.height,
      x2 = to.x + to.width / 2,
      y2 = to.y;
    if (!backward)
      return {
        ...edge,
        loop,
        path: `M ${x1} ${y1} C ${x1} ${y1 + 30}, ${x2} ${y2 - 30}, ${x2} ${y2}`,
        labelX: (x1 + x2) / 2 + 8,
        labelY: (y1 + y2) / 2,
      };
    const side =
      Math.max(from.x + from.width, to.x + to.width) + 24 + (index % 3) * 16;
    return {
      ...edge,
      loop,
      path: `M ${from.x + from.width} ${from.y + 70} C ${side + 40} ${from.y + 70}, ${side + 40} ${to.y + 28}, ${to.x + to.width} ${to.y + 28}`,
      labelX: side + 6,
      labelY: (from.y + to.y) / 2 + 50,
    };
  });
  return {
    width: width + 100,
    height: Math.max(250, ...[...positions.values()].map((p) => p.y + 170)),
    positions,
    edges,
  };
}
