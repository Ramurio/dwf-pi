/** Local UI memory: keys include run / activation / attempt, never array positions. */
export class ViewMemory {
  contexts = new Map();
  expanded = new Map();
  descendants(root) { return Array.from(root?.children ?? []).flatMap(child => [child, ...this.descendants(child)]); }
  identify(root) {
    const walk = (node, parent) => {
      const counts = new Map();
      for (const child of Array.from(node.children ?? [])) {
        const label = child.id || child.dataset?.uiKey || `${child.tagName}:${child.tagName?.toLowerCase() === 'details' ? child.children?.[0]?.textContent : child.tagName?.toLowerCase() === 'button' ? child.textContent : child.getAttribute?.('aria-label') ?? ''}`;
        const n = counts.get(label) ?? 0; counts.set(label, n+1);
        const path = [...parent, [label, n]];
        child.dataset.memoryKey = JSON.stringify(path); walk(child, path);
      }
    };
    walk(root, [root.id]);
  }
  capture(root, context, document) {
    if (!root) return;
    this.identify(root);
    const saved = new Map();
    for (const node of [root, ...this.descendants(root)]) {
      const value = { top: node.scrollTop, left: node.scrollLeft };
      if (node.tagName?.toLowerCase() === 'details') value.open = node.open;
      if (document.activeElement === node) {
        value.focus = true;
        if (typeof node.selectionStart === 'number') value.selection = [node.selectionStart, node.selectionEnd, node.selectionDirection];
      }
      saved.set(node.dataset.memoryKey ?? root.id, value);
    }
    this.contexts.set(context, saved);
  }
  restore(root, context) {
    this.identify(root);
    const saved = this.contexts.get(context);
    if (!saved) return;
    for (const node of [root, ...this.descendants(root)]) {
      const value = saved.get(node.dataset.memoryKey ?? root.id);
      if (!value) continue;
      if (value.open !== undefined && root.id !== "outline") node.open = value.open;
      if (value.focus && !node.disabled) { node.focus({ preventScroll: true }); if (value.selection) node.setSelectionRange(...value.selection); }
      node.scrollTop = value.top; node.scrollLeft = value.left;
    }
  }
}
