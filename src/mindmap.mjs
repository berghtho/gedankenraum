export const relationLabels = { builds: 'baut auf', contradicts: 'widerspricht', example: 'Beispiel für' };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// A missing/filtered parent makes an idea a visible root. Imported cycles are broken
// locally for display, without silently changing the user's saved relationships.
export function layoutMindmap(ideas, collapsed = new Set()) {
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const children = new Map();
  const roots = [];
  for (const idea of ideas) {
    if (!idea.parentId || !byId.has(idea.parentId) || idea.parentId === idea.id) roots.push(idea);
    else {
      if (!children.has(idea.parentId)) children.set(idea.parentId, []);
      children.get(idea.parentId).push(idea);
    }
  }
  const nodes = [];
  const edges = [];
  const visited = new Set();
  let row = 0;
  const visit = (idea, depth, parent = null, hidden = false) => {
    if (visited.has(idea.id)) return;
    visited.add(idea.id);
    const node = { idea, x: 32 + depth * 300, y: 32 + row * 112, children: (children.get(idea.id) ?? []).length };
    if (!hidden) {
      row += 1;
      nodes.push(node);
      if (parent) edges.push({ from: parent, to: node });
    }
    for (const child of children.get(idea.id) ?? []) visit(child, depth + 1, node, hidden || collapsed.has(idea.id));
  };
  for (const idea of roots) visit(idea, 0);
  for (const idea of ideas) if (!visited.has(idea.id)) visit(idea, 0);
  return { nodes, edges, width: Math.max(600, ...nodes.map((node) => node.x + 288)), height: Math.max(380, row * 112 + 64) };
}

export function mindmapMarkup(ideas, selectedId, colorFor, { collapsed, zoom }) {
  const layout = layoutMindmap(ideas, collapsed);
  const positions = new Map(layout.nodes.map((node) => [node.idea.id, node]));
  const links = layout.edges.map(({ from, to }) => `<path d="M${from.x + 248},${from.y + 42} C${from.x + 278},${from.y + 42} ${to.x - 30},${to.y + 42} ${to.x},${to.y + 42}"/>`);
  for (const from of layout.nodes) for (const relation of from.idea.relations ?? []) {
    const to = positions.get(relation.targetId);
    if (!to || (from.idea.id !== selectedId && to.idea.id !== selectedId) || !relationLabels[relation.type]) continue;
    const x1 = from.x + 124; const y1 = from.y + 84;
    const x2 = to.x + 124; const y2 = to.y + 84;
    links.push(`<path class="ib-mm-relation" marker-end="url(#mm-arrow)" d="M${x1},${y1} Q${(x1 + x2) / 2 + 80},${Math.max(y1, y2) + 48} ${x2},${y2}"><title>${escape(`${from.idea.title} ${relationLabels[relation.type]} ${to.idea.title}`)}</title></path>`);
  }
  return `<div class="ib-mm-toolbar" aria-label="Mindmap Werkzeuge">
    <button type="button" data-mm-new="root">+ Gedanke</button>
    ${selectedId ? '<button type="button" data-mm-new="child">+ Untergedanke</button><details class="ib-map-more"><summary>Mehr</summary><button type="button" data-mm-new="sibling">+ Nachbar</button><button type="button" data-mm-move>Verschieben</button></details>' : ''}
    <span class="ib-mm-zoom"><button type="button" data-mm-zoom="out" aria-label="Verkleinern">−</button><button type="button" data-mm-zoom="reset" title="Originalgröße">${Math.round(zoom * 100)}%</button><button type="button" data-mm-zoom="in" aria-label="Vergrößern">+</button></span>
  </div>${selectedId ? '<p class="ib-mm-hint">Tab: Untergedanke · Enter: Nachbar · F2: Weiterschreiben</p>' : ''}
  <div class="ib-mm-viewport" data-mm-viewport tabindex="0" aria-label="Mindmap, freie Fläche ziehen zum Schwenken">
    <div class="ib-mm-size" style="width:${layout.width * zoom}px;height:${layout.height * zoom}px">
      <div class="ib-mm-canvas" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${zoom})">
        <svg class="ib-mm-lines" width="${layout.width}" height="${layout.height}" aria-hidden="true"><defs><marker id="mm-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8"/></marker></defs>${links.join('')}</svg>
        ${layout.nodes.map(({ idea, x, y, children }) => `<div class="ib-mm-node${idea.id === selectedId ? ' is-selected' : ''}" style="left:${x}px;top:${y}px;--node-color:${colorFor(idea.topic)}" data-mm-id="${escape(idea.id)}">
          <button class="ib-mm-select" type="button" data-idea-id="${escape(idea.id)}" aria-label="${escape(idea.title)}"><span>${escape(idea.topic)}</span><b>${escape(idea.title)}</b>${idea.analysisState === 'pending' ? '<i>Analyse läuft …</i>' : ''}</button>
          ${children ? `<button class="ib-mm-collapse" type="button" data-mm-collapse="${escape(idea.id)}" aria-expanded="${!collapsed.has(idea.id)}" aria-label="Zweig ${collapsed.has(idea.id) ? 'ausklappen' : 'einklappen'}">${collapsed.has(idea.id) ? '+' : '−'} ${children}</button>` : ''}
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}
