// Run from the repository root: node docs/evidence/f08/render.mjs
// Static rounded-SVG QA, not an interactive-app or geometry test.
import fs from 'node:fs';
import ts from 'typescript';
import { layoutGraph } from '../../../src/graph-view/layout.js';

const text = fs.readFileSync('tests/graph-layout-overlap.test.ts', 'utf8');
// Use the exact fixtures of the regression test without running node:test.
const start = text.indexOf('const graph =');
const end = text.indexOf('test("overlap metric');
if (start < 0 || end <= start) throw new Error('Fixture boundaries changed');
const fixtures = Function(ts.transpile(text.slice(start, end)) + ';return fixtures')();
let html = '<!doctype html><meta charset="utf-8"><title>F08 rounded SVG fixtures</title><body style="background:#fff;font:14px sans-serif">';
for (const [i, graph] of fixtures.entries()) {
  const layout = layoutGraph(graph);
  html += `<h2>Fixture ${i}</h2><svg width="1200" height="${layout.height * Math.min(1, 1200 / layout.width)}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">`;
  for (const edge of layout.edges) {
    html += `<path d="${edge.path}" fill="none" stroke="white" stroke-width="6"/><path d="${edge.path}" fill="none" stroke="#334155" stroke-width="2"/>`;
  }
  for (const edge of layout.edges) {
    const b = edge.labelBox;
    html += `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="white"/><text x="${edge.labelX}" y="${edge.labelY}">${edge.label}</text>`;
  }
  for (const [id, b] of layout.positions) {
    html += `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="8" fill="#eee" stroke="#aaa"/><text x="${b.x + 16}" y="${b.y + 30}">${id}</text>`;
  }
  html += '</svg>';
}
fs.writeFileSync('docs/evidence/f08/fixtures.html', html + '</body>');
