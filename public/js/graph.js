/* Knowledge graph ("思维星图"). Global: Graph
 * Full-screen canvas force-directed view of articles, categories, tags,
 * collections and their relations. Layouts: force / cluster / timeline /
 * hierarchy / path.
 */
const Graph = (() => {
  const SETTINGS_KEY = 'plume-graph-v2';

  const defaults = {
    mode: 'dark',         // dark (星空) | paper
    layout: 'force',      // force | cluster | timeline | hierarchy | path
    showCats: true,
    showTags: false,
    showCols: true,
    sameTagLinks: false,
    depth: 2              // focus depth: 1 | 2 | 0 (=all)
  };

  const loadSettings = () => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...defaults }; }
  };

  const PALETTE = {
    paper: {
      bg: '#faf9f6', edge: 'rgba(110,102,88,0.28)', edgeLit: 'rgba(140,58,63,0.75)',
      label: '#2b2823', labelDim: '#8a857c', halo: 'rgba(68,105,91,0.18)',
      article: '#44695b', idea: '#68548c', category: '#8c3a3f', tag: '#a09a8e', collection: '#3e5c82',
      panel: '#f3f1ea', selRect: 'rgba(68,105,91,0.1)'
    },
    dark: {
      bg: '#0e1016', edge: 'rgba(200,195,210,0.16)', edgeLit: 'rgba(222,140,120,0.8)',
      label: '#e6e2d8', labelDim: '#77737c', halo: 'rgba(222,140,120,0.2)',
      article: '#c4756a', idea: '#a795c4', category: '#d99a62', tag: '#6f6a76', collection: '#7fa0c4',
      panel: '#1c1b20', selRect: 'rgba(222,140,120,0.08)'
    }
  };

  function render(container) {
    const S = loadSettings();
    const save = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));

    // ---------- view state ----------
    const view = {
      x: 0, y: 0, zoom: 1,
      nodes: [], edges: [], byId: new Map(),
      alpha: 1,
      hover: null, selected: null, multi: new Set(),
      focusDepthMap: null,
      search: '',
      filter: { categoryId: '', tag: '', status: '', days: 0 },
      drag: null, panning: null, boxSel: null,
      activePath: '', pathIndex: 0, playTimer: null,
      raf: 0, destroyed: false
    };

    container.innerHTML = '';
    const shell = UI.el(`<div class="graph-shell mode-${S.mode}">
      <div class="graph-toolbar">
        <div class="gt-left">
          <span class="gt-title">${UI.icon('graph', 16)} 思维星图</span>
          <input class="input input-sm gt-search" placeholder="搜索文章或主题…">
          <select class="input input-sm" data-g="fcat"><option value="">全部分类</option></select>
          <select class="input input-sm" data-g="ftag"><option value="">全部标签</option></select>
          <select class="input input-sm" data-g="fstatus"><option value="">全部状态</option></select>
          <select class="input input-sm" data-g="fdays">
            <option value="0">全部时间</option><option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option><option value="365">最近一年</option>
          </select>
        </div>
        <div class="gt-right">
          <button class="btn btn-sm" data-g="new">${UI.icon('plus', 13)} 新建</button>
          <button class="btn btn-sm" data-g="layout">${UI.icon('template', 13)} <span class="gt-layout-name"></span></button>
          <button class="btn btn-sm" data-g="paths">${UI.icon('external', 13)} 思维路径</button>
          <button class="icon-btn" data-g="fullscreen" title="全屏">${UI.icon('focus')}</button>
          <button class="icon-btn" data-g="settings" title="图谱设置">${UI.icon('settings')}</button>
        </div>
      </div>
      <canvas class="graph-canvas"></canvas>
      <div class="graph-legend"></div>
      <div class="graph-hint">拖动画布平移 · 滚轮缩放 · 双击打开文章 · 拖一个节点到另一个节点上建立关系 · Shift + 拖动框选</div>
      <div class="graph-pathbar" hidden></div>
      <div class="graph-multibar" hidden></div>
      <aside class="graph-panel" hidden></aside>
    </div>`);
    container.appendChild(shell);

    const canvas = shell.querySelector('.graph-canvas');
    const ctx = canvas.getContext('2d');
    const panel = shell.querySelector('.graph-panel');
    const pathbar = shell.querySelector('.graph-pathbar');
    const multibar = shell.querySelector('.graph-multibar');

    // ---------- graph construction ----------

    const degreeMap = new Map();

    function articleVisible(a) {
      const f = view.filter;
      if (f.categoryId && !Store.categoryDescendants(f.categoryId).includes(a.categoryId)) return false;
      if (f.tag && !(a.tags || []).includes(f.tag)) return false;
      if (f.status && a.status !== f.status) return false;
      if (f.days && Date.now() - new Date(a.updatedAt).getTime() > f.days * 86400000) return false;
      return true;
    }

    function buildGraph() {
      const prev = new Map(view.nodes.map((n) => [n.id, n]));
      const nodes = [];
      const edges = [];
      const push = (node) => {
        const old = prev.get(node.id);
        if (old) Object.assign(node, { x: old.x, y: old.y, vx: old.vx, vy: old.vy });
        else {
          const angle = Math.random() * Math.PI * 2;
          const rad = 120 + Math.random() * 260;
          node.x = Math.cos(angle) * rad;
          node.y = Math.sin(angle) * rad;
          node.vx = 0; node.vy = 0;
        }
        nodes.push(node);
      };

      const articles = Store.liveArticles().filter(articleVisible);
      const artIds = new Set(articles.map((a) => a.id));

      degreeMap.clear();
      const bump = (id) => degreeMap.set(id, (degreeMap.get(id) || 0) + 1);

      // article-article edges
      for (const l of Store.state.links) {
        if (artIds.has(l.fromId) && artIds.has(l.toId)) {
          edges.push({ a: l.fromId, b: l.toId, kind: 'link', type: l.type, directed: l.directed, linkId: l.id });
          bump(l.fromId); bump(l.toId);
        }
      }
      for (const a of articles) {
        for (const t of Store.wikiRefs(a.id)) {
          if (artIds.has(t.id) && !edges.some((e) => e.kind === 'link' && ((e.a === a.id && e.b === t.id) || (e.a === t.id && e.b === a.id)))) {
            edges.push({ a: a.id, b: t.id, kind: 'wiki', type: 'wikilink', directed: true });
            bump(a.id); bump(t.id);
          }
        }
      }
      for (const p of Store.state.paths) {
        const items = (p.items || []).filter((id) => artIds.has(id));
        for (let i = 0; i < items.length - 1; i++) {
          edges.push({ a: items[i], b: items[i + 1], kind: 'path', type: 'path', directed: true, pathId: p.id });
          bump(items[i]); bump(items[i + 1]);
        }
      }
      if (S.sameTagLinks) {
        for (let i = 0; i < articles.length; i++) {
          for (let j = i + 1; j < articles.length; j++) {
            const shared = (articles[i].tags || []).filter((t) => (articles[j].tags || []).includes(t));
            if (shared.length >= 2) edges.push({ a: articles[i].id, b: articles[j].id, kind: 'sametag', directed: false });
          }
        }
      }

      for (const a of articles) {
        const deg = degreeMap.get(a.id) || 0;
        push({
          id: a.id, kind: a.status === 'idea' ? 'idea' : 'article', ref: a,
          label: a.title || '未命名',
          r: Math.min(22, 7 + Math.sqrt(a.wordCount || 0) / 9 + deg * 1.1 + (a.pinned ? 4 : 0) + (a.favorite ? 1.5 : 0))
        });
      }

      if (S.showCats) {
        const usedCats = new Set(articles.map((a) => a.categoryId).filter(Boolean));
        for (const cid of usedCats) {
          const c = Store.category(cid);
          if (!c) continue;
          push({ id: `cat:${cid}`, kind: 'category', ref: c, label: c.name, r: 11 });
          for (const a of articles) {
            if (a.categoryId === cid) edges.push({ a: `cat:${cid}`, b: a.id, kind: 'struct', directed: false });
          }
        }
      }
      if (S.showCols) {
        for (const col of Store.state.collections) {
          const members = col.items.filter((i) => artIds.has(i.articleId));
          if (!members.length) continue;
          push({ id: `col:${col.id}`, kind: 'collection', ref: col, label: col.name, r: 11 });
          for (const m of members) edges.push({ a: `col:${col.id}`, b: m.articleId, kind: 'struct', directed: false });
        }
      }
      if (S.showTags) {
        const counts = new Map();
        for (const a of articles) for (const t of a.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
        for (const [t, count] of counts) {
          if (count < 2) continue;
          push({ id: `tag:${t}`, kind: 'tag', ref: Store.tagByName(t) || { name: t }, label: t, r: 5 + Math.min(4, count) });
          for (const a of articles) {
            if ((a.tags || []).includes(t)) edges.push({ a: `tag:${t}`, b: a.id, kind: 'struct', directed: false });
          }
        }
      }

      view.nodes = nodes;
      view.edges = edges;
      view.byId = new Map(nodes.map((n) => [n.id, n]));
      applyLayoutConstraints(true);
      updateFocus();
      heat();
    }

    // ---------- layouts ----------

    const LAYOUTS = [
      ['force', '自由星图'], ['cluster', '分类聚类'], ['timeline', '时间轴'],
      ['hierarchy', '层级图'], ['path', '思维路径']
    ];

    function applyLayoutConstraints(reset = false) {
      const arts = view.nodes.filter((n) => n.kind === 'article' || n.kind === 'idea');
      for (const n of view.nodes) { n.fx = null; n.fy = null; n.cluster = null; n.hidden = false; }

      if (S.layout === 'cluster') {
        const roots = [...new Set(arts.map((n) => {
          let c = Store.category(n.ref.categoryId);
          let guard = 0;
          while (c && c.parentId && guard++ < 10) c = Store.category(c.parentId);
          return c?.id || '';
        }))];
        const centers = new Map();
        roots.forEach((rid, i) => {
          const angle = (i / roots.length) * Math.PI * 2;
          centers.set(rid, { x: Math.cos(angle) * 320, y: Math.sin(angle) * 320 });
        });
        for (const n of arts) {
          let c = Store.category(n.ref.categoryId);
          let guard = 0;
          while (c && c.parentId && guard++ < 10) c = Store.category(c.parentId);
          n.cluster = centers.get(c?.id || '') || { x: 0, y: 0 };
        }
        for (const n of view.nodes) {
          if (n.kind === 'category') {
            let c = n.ref, guard = 0;
            while (c && c.parentId && guard++ < 10) c = Store.category(c.parentId);
            n.cluster = centers.get(c?.id || '') || { x: 0, y: 0 };
          }
        }
      }

      if (S.layout === 'timeline') {
        const times = arts.map((n) => new Date(n.ref.createdAt).getTime());
        const min = Math.min(...times, Date.now() - 86400000);
        const max = Math.max(...times, Date.now());
        const span = Math.max(max - min, 86400000);
        for (const n of arts) {
          n.fx = ((new Date(n.ref.createdAt).getTime() - min) / span) * 1200 - 600;
        }
        view.timeAxis = { min, max };
      } else {
        view.timeAxis = null;
      }

      if (S.layout === 'hierarchy') {
        const layerY = { category: -260, collection: -90, article: 90, idea: 90, tag: 260 };
        const groups = {};
        for (const n of view.nodes) (groups[n.kind === 'idea' ? 'article' : n.kind] ||= []).push(n);
        for (const [kind, list] of Object.entries(groups)) {
          list.sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh'));
          const gap = Math.min(140, 1300 / Math.max(1, list.length));
          list.forEach((n, i) => {
            n.fx = (i - (list.length - 1) / 2) * gap;
            n.fy = layerY[kind] ?? 90;
          });
        }
      }

      if (S.layout === 'path') {
        const p = Store.state.paths.find((x) => x.id === view.activePath) || Store.state.paths[0];
        if (p) {
          view.activePath = p.id;
          const items = (p.items || []).filter((id) => view.byId.has(id));
          const gap = Math.min(220, 1300 / Math.max(1, items.length));
          for (const n of view.nodes) n.hidden = true;
          items.forEach((id, i) => {
            const n = view.byId.get(id);
            if (n) {
              n.hidden = false;
              n.fx = (i - (items.length - 1) / 2) * gap;
              n.fy = 0;
            }
          });
        }
        renderPathbar();
      } else {
        view.activePath = view.activePath && S.layout === 'path' ? view.activePath : view.activePath;
        pathbar.hidden = S.layout !== 'path';
        stopPlay();
      }
      if (reset && S.layout !== 'force') heat();
    }

    // ---------- physics ----------

    function heat() { view.alpha = Math.max(view.alpha, 0.9); }

    function tick() {
      const nodes = view.nodes.filter((n) => !n.hidden);
      const alpha = view.alpha;
      if (alpha < 0.015) return;

      // repulsion (capped n² — fine for personal libraries)
      const strength = 900;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          if (d2 > 90000) continue;
          const f = (strength * alpha) / d2;
          const fx = dx * f, fy = dy * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      // springs
      for (const e of view.edges) {
        const a = view.byId.get(e.a), b = view.byId.get(e.b);
        if (!a || !b || a.hidden || b.hidden) continue;
        const rest = e.kind === 'struct' ? 120 : 150;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const k = (e.kind === 'sametag' ? 0.002 : 0.01) * alpha;
        const f = k * (d - rest);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      // gravity / cluster pull / integration
      for (const n of nodes) {
        const cx = n.cluster ? n.cluster.x : 0;
        const cy = n.cluster ? n.cluster.y : 0;
        n.vx += (cx - n.x) * 0.0035 * alpha * (n.cluster ? 3 : 1);
        n.vy += (cy - n.y) * 0.0035 * alpha * (n.cluster ? 3 : 1);
        n.vx *= 0.86; n.vy *= 0.86;
        if (view.drag?.node !== n) {
          n.x += n.vx; n.y += n.vy;
        }
        if (n.fx != null) n.x += (n.fx - n.x) * 0.2;
        if (n.fy != null) n.y += (n.fy - n.y) * 0.2;
      }
      view.alpha *= 0.985;
    }

    // ---------- focus / dimming ----------

    function updateFocus() {
      view.focusDepthMap = null;
      if (!view.selected || !view.byId.has(view.selected)) return;
      const adj = new Map();
      const addAdj = (a, b) => {
        (adj.get(a) || adj.set(a, []).get(a)).push(b);
        (adj.get(b) || adj.set(b, []).get(b)).push(a);
      };
      for (const e of view.edges) if (e.kind !== 'sametag') addAdj(e.a, e.b);
      const depth = new Map([[view.selected, 0]]);
      let frontier = [view.selected];
      let d = 0;
      while (frontier.length && d < 8) {
        d++;
        const next = [];
        for (const id of frontier) {
          for (const nb of adj.get(id) || []) {
            if (!depth.has(nb)) { depth.set(nb, d); next.push(nb); }
          }
        }
        frontier = next;
      }
      view.focusDepthMap = depth;
    }

    function nodeAlpha(n) {
      if (view.search) {
        return n.label.toLowerCase().includes(view.search) ? 1 : 0.12;
      }
      if (!view.focusDepthMap) return 1;
      const d = view.focusDepthMap.get(n.id);
      if (d == null) return 0.07;
      const maxD = S.depth === 0 ? 99 : S.depth;
      if (d === 0) return 1;
      if (d === 1) return 1;
      if (d <= maxD) return 0.55;
      return 0.07;
    }

    // ---------- rendering ----------

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      view.w = rect.width; view.h = rect.height;
      makeStars();
    }

    // static star field for the night-sky mode (no animation — quiet by design)
    function makeStars() {
      const count = Math.round((view.w * view.h) / 3800);
      view.stars = Array.from({ length: count }, () => ({
        x: Math.random() * view.w,
        y: Math.random() * view.h,
        r: Math.random() < 0.88 ? 0.4 + Math.random() * 0.8 : 1.1 + Math.random() * 0.9,
        a: 0.12 + Math.random() * 0.55,
        depth: 0.03 + Math.random() * 0.07  // subtle parallax with panning
      }));
    }

    function drawStars() {
      if (!view.stars) makeStars();
      ctx.fillStyle = '#e8ecf4';
      for (const st of view.stars) {
        const x = (st.x + view.x * view.zoom * st.depth % view.w + view.w) % view.w;
        const y = (st.y + view.y * view.zoom * st.depth % view.h + view.h) % view.h;
        ctx.globalAlpha = st.a;
        ctx.beginPath();
        ctx.arc(x, y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const toScreen = (x, y) => [view.w / 2 + (x + view.x) * view.zoom, view.h / 2 + (y + view.y) * view.zoom];
    const toWorld = (sx, sy) => [(sx - view.w / 2) / view.zoom - view.x, (sy - view.h / 2) / view.zoom - view.y];

    function draw() {
      const P = PALETTE[S.mode];
      ctx.clearRect(0, 0, view.w, view.h);
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, view.w, view.h);
      if (S.mode === 'dark') drawStars();

      // timeline axis
      if (view.timeAxis) {
        ctx.strokeStyle = P.edge;
        ctx.fillStyle = P.labelDim;
        ctx.font = '11px sans-serif';
        const { min, max } = view.timeAxis;
        const [, ay] = toScreen(0, 330);
        ctx.beginPath();
        const [x1] = toScreen(-600, 0), [x2] = toScreen(600, 0);
        ctx.moveTo(x1, ay); ctx.lineTo(x2, ay); ctx.stroke();
        for (let i = 0; i <= 4; i++) {
          const t = min + ((max - min) * i) / 4;
          const [tx] = toScreen((i / 4) * 1200 - 600, 0);
          ctx.fillText(new Date(t).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short' }), tx - 20, ay + 16);
        }
      }

      const selEdgeSet = new Set();
      if (view.selected) {
        for (const e of view.edges) if (e.a === view.selected || e.b === view.selected) selEdgeSet.add(e);
      }

      // edges
      for (const e of view.edges) {
        const a = view.byId.get(e.a), b = view.byId.get(e.b);
        if (!a || !b || a.hidden || b.hidden) continue;
        const alpha = Math.min(nodeAlpha(a), nodeAlpha(b));
        if (alpha < 0.1 && !selEdgeSet.has(e)) continue;
        if (e.kind === 'sametag' && !selEdgeSet.has(e)) continue;
        const [x1, y1] = toScreen(a.x, a.y);
        const [x2, y2] = toScreen(b.x, b.y);
        const lit = selEdgeSet.has(e);
        ctx.strokeStyle = lit ? P.edgeLit : P.edge;
        ctx.globalAlpha = lit ? 1 : Math.max(0.15, alpha * (e.kind === 'struct' ? 0.5 : 0.9));
        ctx.lineWidth = e.kind === 'path' ? 2 : lit ? 1.6 : 1;
        ctx.setLineDash(e.kind === 'suggest' || e.kind === 'sametag' ? [4, 4] : e.kind === 'struct' ? [2, 5] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (e.directed && view.zoom > 0.45) {
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const tipX = x2 - Math.cos(angle) * (b.r * view.zoom + 4);
          const tipY = y2 - Math.sin(angle) * (b.r * view.zoom + 4);
          ctx.fillStyle = lit ? P.edgeLit : P.edge;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - Math.cos(angle - 0.45) * 8, tipY - Math.sin(angle - 0.45) * 8);
          ctx.lineTo(tipX - Math.cos(angle + 0.45) * 8, tipY - Math.sin(angle + 0.45) * 8);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // nodes
      for (const n of view.nodes) {
        if (n.hidden) continue;
        const alpha = nodeAlpha(n);
        const [sx, sy] = toScreen(n.x, n.y);
        if (sx < -60 || sy < -60 || sx > view.w + 60 || sy > view.h + 60) continue;
        const r = Math.max(2.5, n.r * view.zoom);
        // LOD: tags fade out when zoomed far away
        if (n.kind === 'tag' && view.zoom < 0.55 && view.hover !== n) continue;
        ctx.globalAlpha = alpha;
        const color = P[n.kind] || P.article;

        if (n.id === view.selected || view.multi.has(n.id)) {
          ctx.beginPath();
          ctx.fillStyle = P.halo;
          ctx.arc(sx, sy, r + 8, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        if (n.kind === 'category') {
          const s = r * 1.15;
          ctx.roundRect(sx - s, sy - s, s * 2, s * 2, 4);
        } else if (n.kind === 'collection') {
          ctx.moveTo(sx, sy - r * 1.3);
          ctx.lineTo(sx + r * 1.3, sy);
          ctx.lineTo(sx, sy + r * 1.3);
          ctx.lineTo(sx - r * 1.3, sy);
          ctx.closePath();
        } else {
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
        }
        ctx.fill();

        if (n.kind === 'idea') {
          ctx.strokeStyle = color;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (n === view.hover || view.drag?.node === n) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        // labels with LOD
        const important = n.r >= 12 || n.kind === 'category' || n.kind === 'collection';
        const showLabel = n === view.hover || n.id === view.selected || view.multi.has(n.id) ||
          (view.zoom >= 1.3) || (view.zoom >= 0.75 && n.kind !== 'tag') || (view.zoom >= 0.45 && important) ||
          (view.search && alpha === 1);
        if (showLabel && alpha > 0.15) {
          ctx.font = `${n.kind === 'category' ? '600 ' : ''}${Math.max(10, Math.min(13, 11 * view.zoom))}px -apple-system, "PingFang SC", sans-serif`;
          ctx.fillStyle = alpha === 1 ? P.label : P.labelDim;
          const label = n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label;
          ctx.fillText(label, sx + r + 6, sy + 4);
        }
        ctx.globalAlpha = 1;
      }

      // box selection rect
      if (view.boxSel) {
        const { x1, y1, x2, y2 } = view.boxSel;
        ctx.fillStyle = PALETTE[S.mode].selRect;
        ctx.strokeStyle = PALETTE[S.mode].edgeLit;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.setLineDash([]);
      }
    }

    function loop() {
      if (view.destroyed) return;
      tick();
      draw();
      view.raf = requestAnimationFrame(loop);
    }

    // ---------- hit testing ----------

    function nodeAt(sx, sy) {
      const [wx, wy] = toWorld(sx, sy);
      let best = null, bestD = Infinity;
      for (const n of view.nodes) {
        if (n.hidden) continue;
        const dx = n.x - wx, dy = n.y - wy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const hitR = Math.max(n.r, 10 / view.zoom);
        if (d < hitR && d < bestD) { best = n; bestD = d; }
      }
      return best;
    }

    // ---------- interactions ----------

    let lastClick = 0;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const node = nodeAt(sx, sy);
      if (e.shiftKey && !node) {
        view.boxSel = { x1: sx, y1: sy, x2: sx, y2: sy };
      } else if (node) {
        view.drag = { node, moved: false, sx, sy };
        heat();
      } else {
        view.panning = { sx, sy, ox: view.x, oy: view.y };
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (view.boxSel) { view.boxSel.x2 = sx; view.boxSel.y2 = sy; return; }
      if (view.drag) {
        const [wx, wy] = toWorld(sx, sy);
        if (Math.abs(sx - view.drag.sx) + Math.abs(sy - view.drag.sy) > 4) view.drag.moved = true;
        view.drag.node.x = wx; view.drag.node.y = wy;
        view.drag.node.vx = 0; view.drag.node.vy = 0;
        heat();
        return;
      }
      if (view.panning) {
        view.x = view.panning.ox + (sx - view.panning.sx) / view.zoom;
        view.y = view.panning.oy + (sy - view.panning.sy) / view.zoom;
        return;
      }
      view.hover = nodeAt(sx, sy);
      canvas.style.cursor = view.hover ? 'pointer' : 'grab';
    });

    canvas.addEventListener('pointerup', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

      if (view.boxSel) {
        const { x1, y1, x2, y2 } = view.boxSel;
        view.multi.clear();
        for (const n of view.nodes) {
          if (n.hidden || (n.kind !== 'article' && n.kind !== 'idea')) continue;
          const [nx, ny] = toScreen(n.x, n.y);
          if (nx >= Math.min(x1, x2) && nx <= Math.max(x1, x2) && ny >= Math.min(y1, y2) && ny <= Math.max(y1, y2)) {
            view.multi.add(n.id);
          }
        }
        view.boxSel = null;
        renderMultibar();
        return;
      }

      if (view.drag) {
        const { node, moved } = view.drag;
        view.drag = null;
        if (moved) {
          // dropping one article onto another creates a relation
          const target = view.nodes.find((n) => {
            if (n === node || n.hidden || (n.kind !== 'article' && n.kind !== 'idea')) return false;
            if (node.kind !== 'article' && node.kind !== 'idea') return false;
            const dx = n.x - node.x, dy = n.y - node.y;
            return Math.sqrt(dx * dx + dy * dy) < n.r + node.r + 6;
          });
          if (target) {
            UI.menu({ getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) },
              [{ header: `${node.label} → ${target.label}` },
                ...Store.LINK_TYPES.map((t) => ({
                  label: t.name,
                  onClick: async () => { await Store.addLink(node.id, target.id, t.id); buildGraph(); }
                }))]);
          }
          return;
        }
        // click (no movement): select
        const now = Date.now();
        if (now - lastClick < 350 && view.selected === node.id && (node.kind === 'article' || node.kind === 'idea')) {
          location.hash = `#/edit/${node.id}`;
          return;
        }
        lastClick = now;
        view.selected = node.id;
        view.multi.clear();
        renderMultibar();
        updateFocus();
        addSuggestEdges(node);
        renderPanel(node);
        return;
      }

      if (view.panning) {
        const movedFar = Math.abs(sx - view.panning.sx) + Math.abs(sy - view.panning.sy) > 5;
        view.panning = null;
        if (!movedFar) {
          view.selected = null;
          view.multi.clear();
          renderMultibar();
          view.edges = view.edges.filter((x) => x.kind !== 'suggest');
          updateFocus();
          panel.hidden = true;
        }
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const [wx, wy] = toWorld(sx, sy);
      const factor = Math.exp(-e.deltaY * 0.0015);
      view.zoom = Math.min(3, Math.max(0.18, view.zoom * factor));
      const [nwx, nwy] = toWorld(sx, sy);
      view.x += nwx - wx;
      view.y += nwy - wy;
    }, { passive: false });

    function addSuggestEdges(node) {
      view.edges = view.edges.filter((e) => e.kind !== 'suggest');
      if (node.kind !== 'article' && node.kind !== 'idea') return;
      for (const s of Store.suggestRelated(node.id, 5)) {
        if (view.byId.has(s.article.id)) {
          view.edges.push({ a: node.id, b: s.article.id, kind: 'suggest', directed: false });
        }
      }
    }

    // ---------- detail panel ----------

    function renderPanel(node) {
      panel.hidden = false;
      if (node.kind === 'category') {
        panel.innerHTML = `<div class="panel-head"><h3>分类</h3><button class="icon-btn" data-gp="close">${UI.icon('x', 15)}</button></div>
          <div class="panel-scroll"><h2 class="gp-title">${node.ref.icon || ''} ${UI.esc(Store.categoryPath(node.ref.id))}</h2>
          ${node.ref.description ? `<p class="hint">${UI.esc(node.ref.description)}</p>` : ''}
          <button class="btn btn-sm btn-block" data-gp="open-cat">查看该分类的文章</button></div>`;
        return;
      }
      if (node.kind === 'collection') {
        panel.innerHTML = `<div class="panel-head"><h3>合集</h3><button class="icon-btn" data-gp="close">${UI.icon('x', 15)}</button></div>
          <div class="panel-scroll"><h2 class="gp-title">${UI.esc(node.ref.name)}</h2>
          ${node.ref.intro ? `<p class="hint">${UI.esc(node.ref.intro)}</p>` : ''}
          <button class="btn btn-sm btn-block" data-gp="open-col">打开合集</button></div>`;
        return;
      }
      if (node.kind === 'tag') {
        panel.innerHTML = `<div class="panel-head"><h3>标签</h3><button class="icon-btn" data-gp="close">${UI.icon('x', 15)}</button></div>
          <div class="panel-scroll"><h2 class="gp-title"># ${UI.esc(node.label)}</h2>
          <button class="btn btn-sm btn-block" data-gp="open-tag">查看该标签的文章</button></div>`;
        return;
      }

      const a = node.ref;
      const links = Store.linksOf(a.id);
      const backs = Store.backlinksOf(a.id);
      const suggestions = Store.suggestRelated(a.id, 4);
      const paths = Store.pathsOf(a.id);
      panel.innerHTML = `
        <div class="panel-head"><h3>文章</h3><button class="icon-btn" data-gp="close">${UI.icon('x', 15)}</button></div>
        <div class="panel-scroll">
          <h2 class="gp-title">${UI.esc(a.title || '未命名')}</h2>
          ${a.digest ? `<p class="hint">${UI.esc(a.digest)}</p>` : ''}
          <div class="art-meta" style="margin:6px 0 10px">${UI.statusPill(a.status)}<span>${a.wordCount || 0} 字</span><span>${UI.fmtRelative(a.updatedAt)}</span></div>
          ${a.categoryId ? `<div class="hint">分类:${UI.esc(Store.categoryPath(a.categoryId))}</div>` : ''}
          ${(a.tags || []).length ? `<div class="reader-tags" style="margin:8px 0">${a.tags.map((t) => UI.tagChip(t)).join('')}</div>` : ''}
          ${Store.collectionsOf(a.id).length ? `<div class="hint">合集:${Store.collectionsOf(a.id).map((c) => UI.esc(c.name)).join('、')}</div>` : ''}
          <div class="gp-actions">
            <button class="btn btn-sm btn-primary" data-gp="edit">打开文章</button>
            <button class="btn btn-sm" data-gp="read">阅读</button>
            <button class="btn btn-sm" data-gp="link">添加关联</button>
            <button class="btn btn-sm" data-gp="center">设为中心</button>
          </div>
          <div class="gp-depth">
            聚焦层级:
            <button class="btn btn-xs${S.depth === 1 ? ' btn-primary' : ''}" data-gp="d1">1 层</button>
            <button class="btn btn-xs${S.depth === 2 ? ' btn-primary' : ''}" data-gp="d2">2 层</button>
            <button class="btn btn-xs${S.depth === 0 ? ' btn-primary' : ''}" data-gp="d0">完整</button>
          </div>
          ${links.length ? `<div class="plink-group"><span class="plink-label">关联文章</span><div class="plink-list">${links.map((l) => {
            const other = Store.article(l.fromId === a.id ? l.toId : l.fromId);
            if (!other) return '';
            const typeName = Store.LINK_TYPES.find((t) => t.id === l.type)?.name || l.type;
            return `<div class="plink-row"><span class="plink-type">${UI.esc(typeName)}</span><a href="#" data-gp-sel="${other.id}">${UI.esc(other.title || '未命名')}</a><button class="icon-btn" data-gp-unlink="${l.id}" title="删除关联">${UI.icon('x', 12)}</button></div>`;
          }).join('')}</div></div>` : ''}
          ${backs.length ? `<div class="plink-group"><span class="plink-label">反向链接</span><div class="plink-list">${backs.map((x) => `<a class="plink-item" href="#" data-gp-sel="${x.id}">${UI.esc(x.title || '未命名')}</a>`).join('')}</div></div>` : ''}
          ${paths.length ? `<div class="plink-group"><span class="plink-label">所属思维路径</span><div class="plink-list">${paths.map((p) => `<a class="plink-item" href="#" data-gp-path="${p.id}">${UI.esc(p.name)}(${p.items.length} 篇)</a>`).join('')}</div></div>` : ''}
          ${suggestions.length ? `<div class="plink-group"><span class="plink-label">系统推荐(虚线,未确认)</span><div class="plink-list">${suggestions.map((s) => `<div class="plink-row plink-suggest"><a href="#" data-gp-sel="${s.article.id}" title="${UI.esc(s.reason)}">${UI.esc(s.article.title || '未命名')}</a><button class="btn btn-xs" data-gp-confirm="${s.article.id}">确认</button></div>`).join('')}</div></div>` : ''}
        </div>`;
    }

    panel.addEventListener('click', async (e) => {
      const node = view.selected ? view.byId.get(view.selected) : null;
      const gp = e.target.closest('[data-gp]')?.dataset.gp;
      const sel = e.target.closest('[data-gp-sel]')?.dataset.gpSel;
      const unlink = e.target.closest('[data-gp-unlink]')?.dataset.gpUnlink;
      const confirm = e.target.closest('[data-gp-confirm]')?.dataset.gpConfirm;
      const pathId = e.target.closest('[data-gp-path]')?.dataset.gpPath;
      if (sel) {
        e.preventDefault();
        const target = view.byId.get(sel);
        if (target) {
          view.selected = sel;
          updateFocus(); addSuggestEdges(target); renderPanel(target);
        }
        return;
      }
      if (unlink) { await Store.deleteLink(unlink); buildGraph(); if (node) renderPanel(node); return; }
      if (confirm && node) {
        UI.menu(e.target, Store.LINK_TYPES.map((t) => ({
          label: t.name,
          onClick: async () => { await Store.addLink(node.id, confirm, t.id); buildGraph(); renderPanel(node); }
        })));
        return;
      }
      if (pathId) {
        e.preventDefault();
        S.layout = 'path'; view.activePath = pathId; save();
        syncToolbar(); applyLayoutConstraints(true);
        return;
      }
      if (!gp) return;
      if (gp === 'close') { panel.hidden = true; }
      if (gp === 'edit' && node) location.hash = `#/edit/${node.id}`;
      if (gp === 'read' && node) location.hash = `#/read/${node.id}`;
      if (gp === 'center' && node) { view.x = -node.x; view.y = -node.y; view.zoom = Math.max(view.zoom, 1); }
      if (gp === 'open-cat' && node) location.hash = `#/category/${node.ref.id}`;
      if (gp === 'open-col' && node) location.hash = `#/collection/${node.ref.id}`;
      if (gp === 'open-tag' && node) location.hash = `#/tag/${encodeURIComponent(node.label)}`;
      if (gp === 'link' && node) {
        const candidates = Store.liveArticles().filter((x) => x.id !== node.id).slice(0, 30);
        UI.menu(e.target, candidates.map((x) => ({
          label: x.title || '未命名',
          onClick: () => {
            UI.menu(e.target, Store.LINK_TYPES.map((t) => ({
              label: t.name,
              onClick: async () => { await Store.addLink(node.id, x.id, t.id); buildGraph(); renderPanel(node); }
            })));
          }
        })), { minWidth: 220 });
      }
      if (gp === 'd1' || gp === 'd2' || gp === 'd0') {
        S.depth = Number(gp[1]);
        save();
        if (node) renderPanel(node);
      }
    });

    // ---------- multi-select bar ----------

    function renderMultibar() {
      if (!view.multi.size) { multibar.hidden = true; return; }
      multibar.hidden = false;
      multibar.innerHTML = `已框选 ${view.multi.size} 篇文章
        <button class="btn btn-xs btn-primary" data-gm="path">创建思维路径</button>
        <button class="btn btn-xs" data-gm="clear">取消</button>`;
    }

    multibar.addEventListener('click', async (e) => {
      const gm = e.target.closest('[data-gm]')?.dataset.gm;
      if (gm === 'clear') { view.multi.clear(); renderMultibar(); }
      if (gm === 'path')

 {
        const ordered = [...view.multi].map((id) => view.byId.get(id)).filter(Boolean)
          .sort((a, b) => a.x - b.x).map((n) => n.id);
        openPathEditor({ items: ordered });
        view.multi.clear();
        renderMultibar();
      }
    });

    // ---------- thought paths ----------

    function openPathEditor(init = {}) {
      const data = { name: '', intro: '', readingMode: '按顺序阅读', items: [], ...init };
      const body = UI.el(`<div class="form-col">
        <label class="form-label">路径名称</label>
        <input class="input" data-pe="name" value="${UI.esc(data.name)}" placeholder="例如:World Model → Final Method">
        <label class="form-label">简介</label>
        <textarea class="input" rows="2" data-pe="intro" placeholder="这条路径讲了什么?">${UI.esc(data.intro)}</textarea>
        <label class="form-label">推荐阅读方式</label>
        <input class="input input-sm" data-pe="mode" value="${UI.esc(data.readingMode)}" placeholder="按顺序阅读 / 先看结论 / …">
        <label class="form-label">节点顺序(拖动调整)</label>
        <div class="pe-items"></div>
        <button class="btn btn-sm" data-pe="add">${UI.icon('plus', 13)} 添加文章</button>
      </div>`);
      const itemsBox = body.querySelector('.pe-items');
      const renderItems = () => {
        itemsBox.innerHTML = '';
        data.items.forEach((id, i) => {
          const a = Store.article(id);
          if (!a) return;
          const row = UI.el(`<div class="pe-item" draggable="true" data-i="${i}"><span class="cat-drag">${UI.icon('grip', 13)}</span><span class="pe-num">${i + 1}</span><span class="pe-title">${UI.esc(a.title || '未命名')}</span><button class="icon-btn">${UI.icon('x', 12)}</button></div>`);
          row.querySelector('.icon-btn').addEventListener('click', () => { data.items.splice(i, 1); renderItems(); });
          row.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/pe', String(i)));
          row.addEventListener('dragover', (ev) => ev.preventDefault());
          row.addEventListener('drop', (ev) => {
            ev.preventDefault();
            const from = Number(ev.dataTransfer.getData('text/pe'));
            const [moved] = data.items.splice(from, 1);
            data.items.splice(i, 0, moved);
            renderItems();
          });
          itemsBox.appendChild(row);
        });
        if (!data.items.length) itemsBox.innerHTML = '<div class="hint">还没有文章,点击下方按钮添加</div>';
      };
      body.querySelector('[data-pe="add"]').addEventListener('click', (e) => {
        const candidates = Store.liveArticles().filter((a) => !data.items.includes(a.id)).slice(0, 30);
        UI.menu(e.target, candidates.map((a) => ({
          label: a.title || '未命名',
          onClick: () => { data.items.push(a.id); renderItems(); }
        })).concat(candidates.length ? [] : [{ label: '没有可添加的文章', disabled: true }]), { minWidth: 240 });
      });
      renderItems();
      UI.modal({
        title: data.id ? '编辑思维路径' : '新建思维路径', body, width: 520,
        footer: [
          { label: '取消' },
          ...(data.id ? [{ label: '删除路径', kind: 'btn-danger-ghost', onClick: async () => { await Store.deletePath(data.id); buildGraph(); } }] : []),
          { label: '保存', kind: 'btn-primary', onClick: async () => {
            data.name = body.querySelector('[data-pe="name"]').value.trim() || '未命名路径';
            data.intro = body.querySelector('[data-pe="intro"]').value.trim();
            data.readingMode = body.querySelector('[data-pe="mode"]').value.trim();
            await Store.savePath(data);
            buildGraph();
            UI.toast('思维路径已保存', 'success');
          } }
        ]
      });
    }

    function renderPathbar() {
      const p = Store.state.paths.find((x) => x.id === view.activePath);
      pathbar.hidden = S.layout !== 'path' || !p;
      if (pathbar.hidden) return;
      const items = (p.items || []).filter((id) => view.byId.has(id));
      const idx = Math.min(view.pathIndex, items.length - 1);
      const current = Store.article(items[idx]);
      pathbar.innerHTML = `
        <b>${UI.esc(p.name)}</b>
        ${p.readingMode ? `<span class="hint">${UI.esc(p.readingMode)}</span>` : ''}
        <span class="pathbar-pos">${items.length ? idx + 1 : 0} / ${items.length}</span>
        <button class="icon-btn" data-pb="prev" title="上一篇">${UI.icon('back', 15)}</button>
        <button class="btn btn-xs" data-pb="play">${view.playTimer ? '暂停' : '播放'}</button>
        <button class="icon-btn" data-pb="next" title="下一篇" style="transform:scaleX(-1)">${UI.icon('back', 15)}</button>
        ${current ? `<span class="pathbar-current">${UI.esc(current.title || '未命名')}</span><button class="btn btn-xs" data-pb="open">打开</button>` : ''}
        <button class="btn btn-xs" data-pb="edit">编辑路径</button>`;
    }

    function stepPath(delta) {
      const p = Store.state.paths.find((x) => x.id === view.activePath);
      if (!p) return;
      const items = (p.items || []).filter((id) => view.byId.has(id));
      if (!items.length) return;
      view.pathIndex = (view.pathIndex + delta + items.length) % items.length;
      const node = view.byId.get(items[view.pathIndex]);
      if (node) {
        view.selected = node.id;
        updateFocus();
        view.x = -node.x; view.y = -node.y;
        view.zoom = Math.max(view.zoom, 1.1);
        renderPanel(node);
      }
      renderPathbar();
    }

    function stopPlay() {
      if (view.playTimer) { clearInterval(view.playTimer); view.playTimer = null; }
    }

    pathbar.addEventListener('click', (e) => {
      const pb = e.target.closest('[data-pb]')?.dataset.pb;
      if (pb === 'prev') { stopPlay(); stepPath(-1); }
      if (pb === 'next') { stopPlay(); stepPath(1); }
      if (pb === 'play') {
        if (view.playTimer) stopPlay();
        else { stepPath(0); view.playTimer = setInterval(() => stepPath(1), 2600); }
        renderPathbar();
      }
      if (pb === 'open') {
        const p = Store.state.paths.find((x) => x.id === view.activePath);
        const id = p?.items?.[view.pathIndex];
        if (id) location.hash = `#/read/${id}`;
      }
      if (pb === 'edit') {
        const p = Store.state.paths.find((x) => x.id === view.activePath);
        if (p) openPathEditor(JSON.parse(JSON.stringify(p)));
      }
    });

    // ---------- toolbar ----------

    function syncToolbar() {
      shell.className = `graph-shell mode-${S.mode}`;
      shell.querySelector('.gt-layout-name').textContent = LAYOUTS.find(([k]) => k === S.layout)?.[1] || '布局';
      const P = PALETTE[S.mode];
      shell.querySelector('.graph-legend').innerHTML = [
        ['article', '文章'], ['idea', '灵感'], ['category', '分类'], ['collection', '合集'], ['tag', '标签']
      ].map(([k, name]) => `<span class="legend-item"><span class="legend-dot" style="background:${P[k]}"></span>${name}</span>`).join('') +
        '<span class="legend-item"><span class="legend-line solid"></span>已确认关系</span><span class="legend-item"><span class="legend-line dashed"></span>系统推荐</span>';
    }

    function fillFilters() {
      const catSel = shell.querySelector('[data-g="fcat"]');
      const walk = (pid, depth) => {
        for (const c of Store.childCategories(pid)) {
          catSel.appendChild(UI.el(`<option value="${c.id}">${'　'.repeat(depth)}${UI.esc(c.name)}</option>`));
          walk(c.id, depth + 1);
        }
      };
      walk('', 0);
      const tagSel = shell.querySelector('[data-g="ftag"]');
      for (const t of Store.state.tags) tagSel.appendChild(UI.el(`<option value="${UI.esc(t.name)}">${UI.esc(t.name)}</option>`));
      const stSel = shell.querySelector('[data-g="fstatus"]');
      for (const s of Store.allStatuses()) stSel.appendChild(UI.el(`<option value="${s.id}">${UI.esc(s.name)}</option>`));
    }

    shell.querySelector('.gt-search').addEventListener('input', UI.debounce((e) => {
      view.search = e.target.value.trim().toLowerCase();
    }, 200));

    shell.querySelectorAll('select[data-g]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.g;
        if (key === 'fcat') view.filter.categoryId = sel.value;
        if (key === 'ftag') view.filter.tag = sel.value;
        if (key === 'fstatus') view.filter.status = sel.value;
        if (key === 'fdays') view.filter.days = Number(sel.value);
        buildGraph();
      });
    });

    shell.querySelector('.graph-toolbar').addEventListener('click', (e) => {
      const g = e.target.closest('button[data-g]')?.dataset.g;
      if (!g) return;
      const anchor = e.target.closest('button');
      if (g === 'new') {
        UI.menu(anchor, [
          { label: '新建文章', icon: 'file', onClick: async () => { const a = await Store.createArticle(); location.hash = `#/edit/${a.id}`; } },
          { label: '新建灵感', icon: 'sparkle', onClick: async () => { const a = await Store.createArticle({ status: 'idea' }); location.hash = `#/edit/${a.id}`; } }
        ], { align: 'right' });
      }
      if (g === 'layout') {
        UI.menu(anchor, LAYOUTS.map(([key, name]) => ({
          label: name, checked: S.layout === key,
          onClick: () => {
            if (key === 'path' && !Store.state.paths.length) { UI.toast('先创建一条思维路径(工具栏 → 思维路径)'); return; }
            S.layout = key; save();
            syncToolbar(); applyLayoutConstraints(true);
          }
        })), { align: 'right' });
      }
      if (g === 'paths') {
        UI.menu(anchor, [
          ...Store.state.paths.map((p) => ({
            label: `${p.name}(${p.items.length} 篇)`,
            onClick: () => { S.layout = 'path'; view.activePath = p.id; view.pathIndex = 0; save(); syncToolbar(); applyLayoutConstraints(true); }
          })),
          Store.state.paths.length ? { sep: true } : null,
          { label: '＋ 新建思维路径', onClick: () => openPathEditor() }
        ], { align: 'right', minWidth: 220 });
      }
      if (g === 'fullscreen') {
        document.fullscreenElement ? document.exitFullscreen() : shell.requestFullscreen?.();
      }
      if (g === 'settings') {
        UI.menu(anchor, [
          { header: '视觉模式' },
          { label: '暗色星图(星空)', checked: S.mode === 'dark', onClick: () => { S.mode = 'dark'; save(); syncToolbar(); } },
          { label: '纸张地图(暖白)', checked: S.mode === 'paper', onClick: () => { S.mode = 'paper'; save(); syncToolbar(); } },
          { sep: true },
          { header: '显示内容' },
          { label: '分类节点', checked: S.showCats, onClick: () => { S.showCats = !S.showCats; save(); buildGraph(); } },
          { label: '合集节点', checked: S.showCols, onClick: () => { S.showCols = !S.showCols; save(); buildGraph(); } },
          { label: '标签节点', checked: S.showTags, onClick: () => { S.showTags = !S.showTags; save(); buildGraph(); } },
          { label: '相同标签连线', checked: S.sameTagLinks, onClick: () => { S.sameTagLinks = !S.sameTagLinks; save(); buildGraph(); } }
        ], { align: 'right', minWidth: 200 });
      }
    });

    // dblclick fallback (some browsers deliver dblclick better than the manual timer)
    canvas.addEventListener('dblclick', (e) => {
      const rect = canvas.getBoundingClientRect();
      const node = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (node && (node.kind === 'article' || node.kind === 'idea')) location.hash = `#/edit/${node.id}`;
    });

    // ---------- boot ----------

    const onResize = () => { resize(); };
    window.addEventListener('resize', onResize);
    const offStore = Store.on(UI.debounce(() => { if (!view.destroyed) buildGraph(); }, 300));

    resize();
    fillFilters();
    syncToolbar();
    buildGraph();
    loop();

    return {
      destroy() {
        view.destroyed = true;
        cancelAnimationFrame(view.raf);
        stopPlay();
        window.removeEventListener('resize', onResize);
        offStore();
      }
    };
  }

  return { render };
})();
