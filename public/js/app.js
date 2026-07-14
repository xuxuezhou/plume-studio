/* App shell: sidebar, router, global search, boot. Global: App */
const App = (() => {
  // bump together with the ?v= query in index.html on each deploy
  const BUILD = '20260714d';
  console.info(`Plume Studio build ${BUILD}`);
  const els = {};
  let currentView = null;      // instance with destroy() for editor/reader
  let currentRoute = '';
  const expanded = new Set(JSON.parse(localStorage.getItem('plume-cats-open') || '[]'));

  // ---------- ui theme ----------

  function applyUiTheme() {
    const pref = Store.state.settings.uiTheme || 'auto';
    const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  // ---------- sidebar ----------

  function navItem(hash, icon, label, { count = '', exact = false } = {}) {
    const active = exact ? currentRoute === hash : currentRoute.startsWith(hash);
    return `<a class="nav-item${active ? ' active' : ''}" href="${hash}">${UI.icon(icon, 16)}<span>${UI.esc(label)}</span>${count !== '' ? `<span class="nav-count">${count}</span>` : ''}</a>`;
  }

  function catTree(parentId, depth) {
    return Store.childCategories(parentId).map((c) => {
      const children = Store.childCategories(c.id);
      const isOpen = expanded.has(c.id);
      const active = currentRoute === `#/category/${c.id}`;
      const count = Store.filterArticles({ categoryId: c.id }).length;
      return `<div class="cat-node" style="--depth:${depth}">
        <div class="nav-item cat-nav${active ? ' active' : ''}" data-cat-nav="${c.id}">
          <button class="cat-caret${children.length ? '' : ' empty'}${isOpen ? ' open' : ''}" data-caret="${c.id}">${UI.icon('chevronRight', 12)}</button>
          <span class="cat-node-icon">${c.icon ? UI.entityIcon(c.icon, 14) : UI.icon('folder', 14)}</span>
          <span class="cat-node-name${c.color ? ` c-${c.color}-text` : ''}">${UI.esc(c.name)}</span>
          ${count ? `<span class="nav-count">${count}</span>` : ''}
        </div>
        ${isOpen && children.length ? `<div class="cat-children">${catTree(c.id, depth + 1)}</div>` : ''}
      </div>`;
    }).join('');
  }

  function renderSidebar() {
    const live = Store.liveArticles();
    const draftsCount = live.filter((a) => ['idea', 'draft', 'writing', 'revising'].includes(a.status)).length;
    const trashCount = Store.trashedArticles().length;
    const views = Store.state.views;
    const collections = Store.state.collections;

    els.sidebar.innerHTML = `
      <div class="side-brand">
        <img src="./favicon.svg" alt="" width="22" height="22">
        <b>Plume Studio</b>
        <span class="side-ver" title="构建版本 ${BUILD}">${BUILD.slice(4)}</span>
        <button class="icon-btn side-theme" data-app="theme" title="切换外观">${document.documentElement.dataset.theme === 'dark' ? UI.icon('sun', 15) : UI.icon('moon', 15)}</button>
      </div>
      <button class="side-search" data-app="search">${UI.icon('search', 15)}<span>搜索…</span><kbd>⌘K</kbd></button>
      <button class="btn btn-primary side-new" data-app="new">${UI.icon('plus', 15)} 新建文章</button>

      <nav class="side-nav">
        ${navItem('#/home', 'home', '首页', { exact: true })}
        ${navItem('#/articles', 'files', '全部文章', { count: live.length })}
        ${navItem('#/recent', 'clock', '最近编辑')}
        ${navItem('#/drafts', 'inbox', '草稿箱', { count: draftsCount || '' })}
        ${navItem('#/favorites', 'star', '收藏')}
        ${navItem('#/graph', 'graph', '思维星图')}
      </nav>

      <div class="side-sec">
        <div class="side-sec-head"><span>分类</span>
          <span class="side-sec-acts"><a class="icon-btn" href="#/categories" title="管理分类">${UI.icon('settings', 13)}</a><button class="icon-btn" data-app="new-cat" title="新建分类">${UI.icon('plus', 13)}</button></span>
        </div>
        <div class="side-cats">${catTree('', 0) || '<div class="side-empty">暂无分类</div>'}</div>
      </div>

      ${views.length ? `<div class="side-sec">
        <div class="side-sec-head"><span>智能视图</span></div>
        ${views.map((v) => `<div class="nav-item view-item${currentRoute === `#/view/${v.id}` ? ' active' : ''}" data-view="${v.id}">
          ${UI.icon('sparkle', 14)}<span>${UI.esc(v.name)}</span>
          <button class="icon-btn view-del" data-view-del="${v.id}" title="删除视图">${UI.icon('x', 12)}</button>
        </div>`).join('')}
      </div>` : ''}

      <div class="side-sec">
        <div class="side-sec-head"><span>合集</span>
          <span class="side-sec-acts"><a class="icon-btn" href="#/collections" title="全部合集">${UI.icon('external', 13)}</a></span>
        </div>
        ${collections.slice(0, 6).map((c) => navItem(`#/collection/${c.id}`, 'layers', c.name, { count: c.items.length || '' })).join('') || '<div class="side-empty">暂无合集</div>'}
      </div>

      <div class="side-foot">
        ${navItem('#/library', 'image', '图片素材库')}
        ${navItem('#/templates', 'template', '模板中心')}
        ${navItem('#/trash', 'trash', '回收站', { count: trashCount || '' })}
        ${navItem('#/settings', 'settings', '设置')}
      </div>`;
  }

  function onSidebarClick(e) {
    const caret = e.target.closest('[data-caret]');
    if (caret) {
      e.preventDefault(); e.stopPropagation();
      const id = caret.dataset.caret;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      localStorage.setItem('plume-cats-open', JSON.stringify([...expanded]));
      renderSidebar();
      return;
    }
    const catNav = e.target.closest('[data-cat-nav]');
    if (catNav) { location.hash = `#/category/${catNav.dataset.catNav}`; return; }
    const viewDel = e.target.closest('[data-view-del]');
    if (viewDel) {
      e.stopPropagation();
      UI.confirm('删除智能视图', '只删除视图本身,不影响文章。').then((yes) => { if (yes) Store.deleteView(viewDel.dataset.viewDel); });
      return;
    }
    const viewItem = e.target.closest('[data-view]');
    if (viewItem) { location.hash = `#/view/${viewItem.dataset.view}`; return; }
    const act = e.target.closest('[data-app]')?.dataset.app;
    if (act === 'search') openSearch();
    if (act === 'new') Store.createArticle().then((a) => { location.hash = `#/edit/${a.id}`; });
    if (act === 'new-cat') UI.prompt('新建分类', { placeholder: '分类名称' }).then((name) => { if (name) Store.saveCategory({ name }); });
    if (act === 'theme') {
      const cur = document.documentElement.dataset.theme;
      Store.saveSettings({ uiTheme: cur === 'dark' ? 'light' : 'dark' }).then(applyUiTheme).then(renderSidebar);
    }
  }

  // ---------- global search ----------

  function openSearch() {
    const body = UI.el(`<div class="gsearch">
      <div class="gsearch-input">${UI.icon('search', 16)}<input placeholder="搜索文章、分类、标签、合集、图片…" autofocus></div>
      <div class="gsearch-results"><div class="side-empty">输入关键词开始搜索</div></div>
    </div>`);
    const input = body.querySelector('input');
    const results = body.querySelector('.gsearch-results');
    const m = UI.modal({ title: '', body, width: 620, cls: 'modal-search' });
    m.el.querySelector('.modal-head').remove();

    const go = (hash) => { m.close(); location.hash = hash; };

    const run = UI.debounce(() => {
      const q = input.value.trim();
      if (!q) { results.innerHTML = '<div class="side-empty">输入关键词开始搜索</div>'; return; }
      const r = Store.globalSearch(q);
      const sections = [];
      if (r.articles.length) {
        sections.push(`<div class="gs-head">文章</div>${r.articles.map((a) => `
          <button class="gs-row" data-go="#/edit/${a.id}">
            ${UI.icon('file', 14)}<span class="gs-title">${UI.esc(a.title || '未命名')}</span>
            <span class="hint">${UI.esc(Store.categoryPath(a.categoryId) || '')} · ${a.wordCount || 0} 字</span>
          </button>`).join('')}`);
      }
      if (r.categories.length) sections.push(`<div class="gs-head">分类</div>${r.categories.map((c) => `<button class="gs-row" data-go="#/category/${c.id}">${UI.icon('folder', 14)}<span class="gs-title">${UI.esc(Store.categoryPath(c.id))}</span></button>`).join('')}`);
      if (r.tags.length) sections.push(`<div class="gs-head">标签</div>${r.tags.map((t) => `<button class="gs-row" data-go="#/tag/${encodeURIComponent(t.name)}">${UI.icon('tag', 14)}<span class="gs-title">${UI.esc(t.name)}</span><span class="hint">${Store.tagUsage(t.name)} 篇</span></button>`).join('')}`);
      if (r.collections.length) sections.push(`<div class="gs-head">合集</div>${r.collections.map((c) => `<button class="gs-row" data-go="#/collection/${c.id}">${UI.icon('layers', 14)}<span class="gs-title">${UI.esc(c.name)}</span></button>`).join('')}`);
      if (r.images.length) sections.push(`<div class="gs-head">图片</div><div class="gs-imgs">${r.images.map((img) => `<button class="gs-img" data-go="#/library"><img src="${Store.imageUrl(`img:${img.id}`)}" alt="" title="${UI.esc(img.name)}"></button>`).join('')}</div>`);
      results.innerHTML = sections.join('') || '<div class="side-empty">没有找到相关内容</div>';
    }, 200);

    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = results.querySelector('[data-go]');
        if (first) go(first.dataset.go);
      }
    });
    results.addEventListener('click', (e) => {
      const row = e.target.closest('[data-go]');
      if (row) go(row.dataset.go);
    });
    setTimeout(() => input.focus(), 60);
  }

  // ---------- router ----------

  function route() {
    const hash = location.hash || '#/home';
    if (hash === currentRoute && (hash.startsWith('#/edit/') || hash.startsWith('#/read/'))) return;
    currentRoute = hash;
    UI.closeMenu();

    if (currentView?.destroy) currentView.destroy();
    currentView = null;
    els.main.onclick = null; // drop the previous view's delegated handler
    document.body.classList.remove('focus-mode');

    const isEditor = hash.startsWith('#/edit/');
    const isReader = hash.startsWith('#/read/');
    const isGraph = hash.startsWith('#/graph');
    document.body.classList.toggle('route-editor', isEditor || isReader || isGraph);

    if (isEditor) {
      const id = hash.split('/')[2];
      currentView = Editor.open(els.main, id, { onBack: () => { location.hash = Store.state.lastListRoute || '#/articles'; } });
    } else if (isGraph) {
      currentView = Graph.render(els.main);
    } else if (isReader) {
      const id = hash.split('/')[2];
      currentView = Reader.render(els.main, id);
    } else {
      els.main.scrollTop = 0;
      Views.render(els.main, hash.slice(1));
    }
    renderSidebar();
  }

  // ---------- change subscription ----------

  let refreshTimer = null;
  function refreshLists() {
    const isDoc = currentRoute.startsWith('#/edit/') || currentRoute.startsWith('#/read/') || currentRoute.startsWith('#/graph');
    if (isDoc) return;
    // an open modal/menu means the user is mid-interaction — retry shortly
    // instead of dropping the refresh
    if (document.querySelector('.modal-overlay, .menu')) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshLists, 300);
      return;
    }
    Views.render(els.main, currentRoute.slice(1));
  }

  const onStoreChange = UI.debounce(() => {
    renderSidebar();
    refreshLists();
  }, 120);

  // ---------- boot ----------

  async function boot() {
    els.sidebar = document.querySelector('#sidebar');
    els.main = document.querySelector('#main');
    els.sidebar.addEventListener('click', onSidebarClick);

    try {
      const result = await Store.init();
      if (result?.rescued) {
        setTimeout(() => UI.toast('检测到本地数据库被清空,已从应急备份恢复文章(图片除外)', 'success'), 600);
      }
    } catch (err) {
      els.main.innerHTML = `<div class="empty-state"><h2>无法启动</h2><p>${UI.esc(err.message)}</p><p class="hint">请确认浏览器允许使用本地存储(IndexedDB),隐私/无痕模式可能不可用。</p></div>`;
      return;
    }

    applyUiTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((Store.state.settings.uiTheme || 'auto') === 'auto') { applyUiTheme(); renderSidebar(); }
    });

    Store.on(onStoreChange);
    window.addEventListener('hashchange', route);
    route();

    // small screens: floating button toggles the off-canvas sidebar
    const mobileBtn = UI.el(`<button class="mobile-nav-btn" aria-label="菜单">${UI.icon('sidebar', 18)}</button>`);
    mobileBtn.addEventListener('click', () => document.body.classList.toggle('side-open'));
    document.body.appendChild(mobileBtn);
    els.sidebar.addEventListener('click', (e) => {
      if (e.target.closest('a, [data-cat-nav], [data-view]')) document.body.classList.remove('side-open');
    });

    // global shortcuts
    window.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    });

    // block accidental navigation on file drops outside drop zones
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { applyUiTheme };
})();
