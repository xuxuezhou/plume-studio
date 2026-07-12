/* List & management pages. Global: Views */
const Views = (() => {
  // per-page UI state that survives re-renders
  const pageState = {
    listMode: localStorage.getItem('plume-list-mode') || 'list',
    filter: {},          // extra filter applied on top of the route's base filter
    selecting: false,
    selected: new Set()
  };

  const esc = UI.esc;

  function navigate(hash) { location.hash = hash; }

  // ---------- shared: article rendering ----------

  function progressOf(a) {
    if (a.targetWords > 0) return Math.min(100, Math.round(((a.wordCount || 0) / a.targetWords) * 100));
    if (a.status === 'done' || a.status === 'archived') return 100;
    return null;
  }

  function coverThumb(a, cls = '') {
    const url = Store.imageUrl(a.cover);
    if (url) return `<div class="cover-thumb ${cls}"><img src="${url}" alt="" loading="lazy"></div>`;
    const ch = (a.title || '文').trim().charAt(0) || '文';
    return `<div class="cover-thumb cover-blank ${cls}"><span>${esc(ch)}</span></div>`;
  }

  function articleMetaLine(a) {
    const cat = Store.category(a.categoryId);
    const bits = [];
    if (cat) bits.push(`<span class="meta-cat">${esc(Store.categoryPath(cat.id))}</span>`);
    bits.push(UI.statusPill(a.status));
    if (a.pinned) bits.push(`<span class="meta-flag">${UI.icon('pin', 12)}</span>`);
    if (a.favorite) bits.push(`<span class="meta-flag fav">${UI.icon('starFill', 12)}</span>`);
    bits.push(`<span>${a.wordCount || 0} 字</span>`);
    bits.push(`<span>${UI.fmtRelative(a.updatedAt)}</span>`);
    if (a.dueDate) bits.push(`<span class="meta-due">${UI.icon('calendar', 11)} ${esc(a.dueDate)}</span>`);
    return bits.join('');
  }

  function articleRow(a) {
    const excerpt = a.digest || MD.textOf(a.blocks || []).replace(/\s+/g, ' ').trim().slice(0, 90);
    const checked = pageState.selected.has(a.id);
    return `<div class="art-row${checked ? ' selected' : ''}" data-id="${a.id}">
      ${pageState.selecting ? `<label class="art-check"><input type="checkbox" data-check="${a.id}" ${checked ? 'checked' : ''}></label>` : ''}
      ${coverThumb(a)}
      <div class="art-main">
        <div class="art-title">${esc(a.title || '未命名')}</div>
        ${excerpt ? `<div class="art-excerpt">${esc(excerpt)}</div>` : ''}
        <div class="art-meta">${articleMetaLine(a)}
          <span class="art-tags">${(a.tags || []).slice(0, 4).map((t) => UI.tagChip(t)).join('')}</span>
        </div>
      </div>
      <button class="icon-btn art-more" data-more="${a.id}" title="更多">${UI.icon('dots', 16)}</button>
    </div>`;
  }

  function articleCard(a) {
    const excerpt = a.digest || MD.textOf(a.blocks || []).replace(/\s+/g, ' ').trim().slice(0, 70);
    return `<div class="art-card" data-id="${a.id}">
      ${coverThumb(a, 'card-cover')}
      <div class="art-card-body">
        <div class="art-title">${esc(a.title || '未命名')}</div>
        ${excerpt ? `<div class="art-excerpt">${esc(excerpt)}</div>` : ''}
        <div class="art-meta">${articleMetaLine(a)}</div>
        ${(a.tags || []).length ? `<div class="art-tags">${a.tags.slice(0, 3).map((t) => UI.tagChip(t)).join('')}</div>` : ''}
      </div>
      <button class="icon-btn art-more" data-more="${a.id}" title="更多">${UI.icon('dots', 16)}</button>
    </div>`;
  }

  function articleMenu(anchor, a) {
    UI.menu(anchor, [
      { label: '编辑', icon: 'pen', onClick: () => navigate(`#/edit/${a.id}`) },
      { label: '阅读', icon: 'eye', onClick: () => navigate(`#/read/${a.id}`) },
      { sep: true },
      { label: a.favorite ? '取消收藏' : '收藏', icon: 'star', onClick: () => Store.updateArticle(a.id, { favorite: !a.favorite }, { touch: false }) },
      { label: a.pinned ? '取消置顶' : '置顶', icon: 'pin', onClick: () => Store.updateArticle(a.id, { pinned: !a.pinned }, { touch: false }) },
      { label: '设置状态', icon: 'check', onClick: () => {
        UI.menu(anchor, Store.allStatuses().map((s) => ({
          label: s.name, checked: a.status === s.id,
          onClick: () => Store.updateArticle(a.id, { status: s.id }, { touch: false })
        })));
      } },
      { label: '移动到分类', icon: 'folder', onClick: () => pickCategory((cid) => Store.updateArticle(a.id, { categoryId: cid }, { touch: false })) },
      { label: '加入合集', icon: 'layers', onClick: () => {
        const cols = Store.state.collections;
        UI.menu(anchor, cols.length ? cols.map((c) => ({
          label: c.name, checked: c.items.some((i) => i.articleId === a.id),
          onClick: () => c.items.some((i) => i.articleId === a.id) ? Store.removeFromCollection(c.id, a.id) : Store.addToCollection(c.id, a.id)
        })) : [{ label: '还没有合集', disabled: true }]);
      } },
      { sep: true },
      { label: '导出…', icon: 'download', onClick: () => Exporter.exportDialog(a.id) },
      { label: '创建副本', icon: 'copy', onClick: () => Store.duplicateArticle(a.id) },
      { sep: true },
      { label: '移到回收站', icon: 'trash', danger: true, onClick: () => Store.trashArticle(a.id) }
    ], { align: 'right' });
  }

  function pickCategory(onPick) {
    const items = [{ label: '未分类', onClick: () => onPick('') }, { sep: true }];
    const walk = (parentId, depth) => {
      for (const cat of Store.childCategories(parentId)) {
        items.push({ label: `${'    '.repeat(depth)}${cat.name}`, onClick: () => onPick(cat.id) });
        walk(cat.id, depth + 1);
      }
    };
    walk('', 0);
    UI.menu({ getBoundingClientRect: () => ({ left: innerWidth / 2 - 100, right: innerWidth / 2 + 100, top: 120, bottom: 124 }) }, items, { minWidth: 220 });
  }

  // ---------- article list page ----------

  function listPage(container, { title, baseFilter = {}, route, emptyText = '还没有文章', showNew = true }) {
    Store.state.lastListRoute = route;
    const filter = { ...baseFilter, ...pageState.filter };
    Store.state.lastListFilter = filter;
    const articles = Store.filterArticles(filter);
    const hasExtraFilter = Object.keys(pageState.filter).some((k) => pageState.filter[k] && (!Array.isArray(pageState.filter[k]) || pageState.filter[k].length));

    container.innerHTML = `
      <header class="page-head">
        <div class="page-head-l"><h2>${esc(title)}</h2><span class="page-count">${articles.length} 篇</span></div>
        <div class="page-head-r">
          ${pageState.selecting ? `<button class="btn btn-sm" data-l="cancel-select">完成</button>` : `<button class="icon-btn" data-l="select" title="批量操作">${UI.icon('check')}</button>`}
          <button class="icon-btn${hasExtraFilter ? ' active' : ''}" data-l="filter" title="筛选">${UI.icon('filter')}</button>
          <button class="icon-btn" data-l="sort" title="排序">${UI.icon('chevronDown')}</button>
          <button class="icon-btn" data-l="mode" title="切换视图">${UI.icon(pageState.listMode === 'list' ? 'template' : 'listUl')}</button>
          ${showNew ? `<button class="btn btn-sm btn-primary" data-l="new">${UI.icon('plus', 14)} 新建文章</button>` : ''}
        </div>
      </header>
      ${hasExtraFilter ? `<div class="filter-bar">${filterChips()}<button class="btn btn-xs" data-l="save-view">${UI.icon('sparkle', 12)} 保存为智能视图</button><button class="btn btn-xs" data-l="clear-filter">清除筛选</button></div>` : ''}
      ${pageState.selecting && pageState.selected.size ? batchBar() : ''}
      ${articles.length === 0
        ? `<div class="empty-state">${UI.icon('file', 32)}<p>${esc(emptyText)}</p>${showNew ? '<button class="btn btn-primary" data-l="new">写第一篇</button>' : ''}</div>`
        : pageState.listMode === 'list'
          ? `<div class="art-list">${articles.map(articleRow).join('')}</div>`
          : `<div class="art-grid">${articles.map(articleCard).join('')}</div>`}
    `;

    container.onclick = async (e) => {
      const more = e.target.closest('[data-more]');
      if (more) { e.stopPropagation(); articleMenu(more, Store.article(more.dataset.more)); return; }
      const check = e.target.closest('[data-check]');
      if (check) {
        check.checked ? pageState.selected.add(check.dataset.check) : pageState.selected.delete(check.dataset.check);
        rerender();
        return;
      }
      const act = e.target.closest('[data-l]')?.dataset.l;
      if (act) { await handleListAction(act, e, route, filter); return; }
      const chip = e.target.closest('[data-fclear]');
      if (chip) { delete pageState.filter[chip.dataset.fclear]; rerender(); return; }
      const batch = e.target.closest('[data-b]');
      if (batch) { await handleBatch(batch.dataset.b, batch); return; }
      const row = e.target.closest('[data-id]');
      if (row) {
        if (pageState.selecting) {
          pageState.selected.has(row.dataset.id) ? pageState.selected.delete(row.dataset.id) : pageState.selected.add(row.dataset.id);
          rerender();
        } else navigate(`#/edit/${row.dataset.id}`);
      }
    };

    function filterChips() {
      const f = pageState.filter;
      const chips = [];
      if (f.statuses?.length) chips.push(['statuses', `状态:${f.statuses.map((s) => Store.statusById(s).name).join('/')}`]);
      if (f.tags?.length) chips.push(['tags', `标签:${f.tags.join(', ')}`]);
      if (f.minWords) chips.push(['minWords', `≥ ${f.minWords} 字`]);
      if (f.updatedWithinDays) chips.push(['updatedWithinDays', `${f.updatedWithinDays} 天内更新`]);
      if (f.notUpdatedDays) chips.push(['notUpdatedDays', `超过 ${f.notUpdatedDays} 天未更新`]);
      if (f.hasImages) chips.push(['hasImages', '包含图片']);
      if (f.noCategory) chips.push(['noCategory', '未分类']);
      if (f.favorite) chips.push(['favorite', '已收藏']);
      if (f.q) chips.push(['q', `搜索:${f.q}`]);
      return chips.map(([k, label]) => `<span class="filter-chip">${esc(label)}<button data-fclear="${k}">×</button></span>`).join('');
    }

    function batchBar() {
      return `<div class="batch-bar">
        <span>已选 ${pageState.selected.size} 篇</span>
        <button class="btn btn-xs" data-b="tag">添加标签</button>
        <button class="btn btn-xs" data-b="category">移动分类</button>
        <button class="btn btn-xs" data-b="status">设置状态</button>
        <button class="btn btn-xs" data-b="collection">加入合集</button>
        <button class="btn btn-xs btn-danger-ghost" data-b="trash">移到回收站</button>
      </div>`;
    }

    async function handleBatch(kind, anchor) {
      const ids = [...pageState.selected];
      if (!ids.length) return;
      if (kind === 'tag') {
        const name = await UI.prompt('为所选文章添加标签', { placeholder: '标签名称' });
        if (name) for (const id of ids) {
          const a = Store.article(id);
          await Store.updateArticle(id, { tags: [...new Set([...(a.tags || []), name])] }, { touch: false });
        }
      }
      if (kind === 'category') pickCategory(async (cid) => { for (const id of ids) await Store.updateArticle(id, { categoryId: cid }, { touch: false }); });
      if (kind === 'status') UI.menu(anchor, Store.allStatuses().map((s) => ({ label: s.name, onClick: async () => { for (const id of ids) await Store.updateArticle(id, { status: s.id }, { touch: false }); } })));
      if (kind === 'collection') {
        const cols = Store.state.collections;
        UI.menu(anchor, cols.length ? cols.map((c) => ({ label: c.name, onClick: async () => { for (const id of ids) await Store.addToCollection(c.id, id); } })) : [{ label: '还没有合集', disabled: true }]);
      }
      if (kind === 'trash' && await UI.confirm('移到回收站', `将所选 ${ids.length} 篇文章移到回收站?`, { danger: true })) {
        for (const id of ids) await Store.trashArticle(id);
        pageState.selected.clear();
      }
    }

    async function handleListAction(act, e, route2, activeFilter) {
      if (act === 'new') {
        const a = await Store.createArticle({ categoryId: baseFilter.categoryId || '' });
        navigate(`#/edit/${a.id}`);
      }
      if (act === 'mode') {
        pageState.listMode = pageState.listMode === 'list' ? 'card' : 'list';
        localStorage.setItem('plume-list-mode', pageState.listMode);
        rerender();
      }
      if (act === 'select') { pageState.selecting = true; pageState.selected.clear(); rerender(); }
      if (act === 'cancel-select') { pageState.selecting = false; pageState.selected.clear(); rerender(); }
      if (act === 'clear-filter') { pageState.filter = {}; rerender(); }
      if (act === 'sort') {
        const f = pageState.filter;
        const set = (sort, dir) => { pageState.filter = { ...f, sort, dir }; rerender(); };
        const cur = `${f.sort || 'updatedAt'}-${f.dir || 'desc'}`;
        UI.menu(e.target.closest('[data-l]'), [
          { label: '最近更新', checked: cur === 'updatedAt-desc', onClick: () => set('updatedAt', 'desc') },
          { label: '最近创建', checked: cur === 'createdAt-desc', onClick: () => set('createdAt', 'desc') },
          { label: '最早创建', checked: cur === 'createdAt-asc', onClick: () => set('createdAt', 'asc') },
          { label: '标题 A→Z', checked: cur === 'title-asc', onClick: () => set('title', 'asc') },
          { label: '字数最多', checked: cur === 'wordCount-desc', onClick: () => set('wordCount', 'desc') },
          { label: '字数最少', checked: cur === 'wordCount-asc', onClick: () => set('wordCount', 'asc') }
        ], { align: 'right' });
      }
      if (act === 'filter') openFilterDialog();
      if (act === 'save-view') {
        const name = await UI.prompt('保存为智能视图', { placeholder: '视图名称,例如:待修改的长文' });
        if (name) {
          await Store.saveView({ name, filter: { ...activeFilter } });
          UI.toast('已保存到侧边栏', 'success');
        }
      }
    }

    function openFilterDialog() {
      const f = { ...pageState.filter };
      const statuses = Store.allStatuses();
      const body = UI.el(`<div class="form-col">
        <label class="form-label">状态</label>
        <div class="status-row-picker">${statuses.map((s) => `<button class="status-opt c-${s.color}${(f.statuses || []).includes(s.id) ? ' active' : ''}" data-st="${s.id}">${esc(s.name)}</button>`).join('')}</div>
        <label class="form-label">包含标签</label><div class="ftags"></div>
        <div class="form-row">
          <div style="flex:1"><label class="form-label">字数不少于</label><input class="input input-sm" type="number" data-f="minWords" value="${f.minWords || ''}" placeholder="如 3000"></div>
          <div style="flex:1"><label class="form-label">最近 N 天内更新</label><input class="input input-sm" type="number" data-f="updatedWithinDays" value="${f.updatedWithinDays || ''}" placeholder="如 7"></div>
          <div style="flex:1"><label class="form-label">超过 N 天未更新</label><input class="input input-sm" type="number" data-f="notUpdatedDays" value="${f.notUpdatedDays || ''}" placeholder="如 30"></div>
        </div>
        <div class="export-opts">
          <label class="check-row"><input type="checkbox" data-f="hasImages" ${f.hasImages ? 'checked' : ''}> 包含图片</label>
          <label class="check-row"><input type="checkbox" data-f="noCategory" ${f.noCategory ? 'checked' : ''}> 没有分类</label>
          <label class="check-row"><input type="checkbox" data-f="favorite" ${f.favorite ? 'checked' : ''}> 已收藏</label>
        </div>
      </div>`);
      body.querySelector('.ftags').appendChild(UI.tagEditor(f.tags || [], (tags) => { f.tags = tags; }));
      body.addEventListener('click', (e2) => {
        const st = e2.target.closest('[data-st]');
        if (st) {
          f.statuses = f.statuses || [];
          f.statuses.includes(st.dataset.st) ? f.statuses = f.statuses.filter((x) => x !== st.dataset.st) : f.statuses.push(st.dataset.st);
          st.classList.toggle('active');
        }
      });
      UI.modal({
        title: '筛选文章', body, width: 520,
        footer: [
          { label: '清除', onClick: () => { pageState.filter = {}; rerender(); } },
          { label: '应用', kind: 'btn-primary', onClick: () => {
            body.querySelectorAll('[data-f]').forEach((el) => {
              const key = el.dataset.f;
              if (el.type === 'checkbox') f[key] = el.checked;
              else f[key] = Number(el.value) || 0;
            });
            pageState.filter = f;
            rerender();
          } }
        ]
      });
    }
  }

  let rerender = () => {};

  // ---------- dashboard ----------

  function dashboard(container) {
    const live = Store.liveArticles();
    const recent = Store.filterArticles({ sort: 'updatedAt' }).slice(0, 8);
    const continueList = recent.filter((a) => a.status !== 'done' && a.status !== 'archived').slice(0, 4);
    const drafts = live.filter((a) => ['idea', 'draft', 'writing', 'revising'].includes(a.status));
    const done = live.filter((a) => a.status === 'done');
    const hour = new Date().getHours();
    const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    const author = Store.state.settings.author;
    const tplByName = (n) => Store.state.templates.find((t) => t.name === n);

    container.innerHTML = `
      <div class="dash">
        <header class="dash-head">
          <h1>${greeting}${author ? `,${esc(author)}` : ''}</h1>
          <p class="hint">今天想写点什么?</p>
        </header>

        <section class="dash-quick">
          <button class="quick-btn primary" data-q="blank">${UI.icon('plus')} 新建空白文章</button>
          <button class="quick-btn" data-q="diary">${UI.icon('notebook', 15)} 日记</button>
          <button class="quick-btn" data-q="essay">${UI.icon('pen', 15)} 随笔</button>
          <button class="quick-btn" data-q="long">${UI.icon('feather', 15)} 长文</button>
          <button class="quick-btn" data-q="series">${UI.icon('bookOpen', 15)} 系列文章</button>
          <button class="quick-btn" data-q="template">${UI.icon('template', 15)} 从模板创建</button>
        </section>

        ${continueList.length ? `<section class="dash-sec">
          <h3>继续写作</h3>
          <div class="continue-row">${continueList.map((a) => {
            const progress = progressOf(a);
            return `<button class="continue-card" data-id="${a.id}">
              <div class="art-title">${esc(a.title || '未命名')}</div>
              <div class="hint">${esc(Store.categoryPath(a.categoryId) || '未分类')} · ${UI.fmtRelative(a.updatedAt)}</div>
              <div class="continue-meta">${a.wordCount || 0} 字 ${UI.statusPill(a.status)}</div>
              ${progress != null ? `<div class="progress"><div class="progress-fill" style="width:${progress}%"></div></div>` : ''}
            </button>`;
          }).join('')}</div>
        </section>` : ''}

        <div class="dash-cols">
          <section class="dash-sec dash-recent">
            <h3>最近文章 <a href="#/articles" class="hint">全部 →</a></h3>
            ${recent.length ? `<div class="recent-list">${recent.map((a) => `
              <button class="recent-row" data-id="${a.id}">
                <span class="art-title">${esc(a.title || '未命名')}</span>
                <span class="hint">${esc(Store.categoryPath(a.categoryId) || '')}</span>
                <span class="hint recent-time">${UI.fmtRelative(a.updatedAt)}</span>
              </button>`).join('')}</div>`
            : '<div class="empty-state small">从上面的入口开始写第一篇吧</div>'}
          </section>

          <section class="dash-sec dash-stats">
            <h3>写作概览</h3>
            <div class="stat-list">
              <div class="stat"><b>${live.length}</b><span>总文章</span></div>
              <div class="stat"><b>${drafts.length}</b><span>草稿</span></div>
              <div class="stat"><b>${Store.weekWords()}</b><span>本周字数</span></div>
              <div class="stat"><b>${done.length}</b><span>已完成</span></div>
              <div class="stat"><b>${Store.streakDays()}</b><span>连续写作天数</span></div>
            </div>
          </section>
        </div>
      </div>`;

    container.onclick = async (e) => {
      const row = e.target.closest('[data-id]');
      if (row) { navigate(`#/edit/${row.dataset.id}`); return; }
      const q = e.target.closest('[data-q]')?.dataset.q;
      if (!q) return;
      const fromTpl = async (name, fallbackTags = []) => {
        const tpl = tplByName(name);
        const a = tpl ? await Store.createFromTemplate(tpl.id) : await Store.createArticle({ tags: fallbackTags });
        navigate(`#/edit/${a.id}`);
      };
      if (q === 'blank') { const a = await Store.createArticle(); navigate(`#/edit/${a.id}`); }
      if (q === 'diary') fromTpl('日记');
      if (q === 'essay') { const a = await Store.createArticle({ tags: ['随笔'] }); navigate(`#/edit/${a.id}`); }
      if (q === 'long') fromTpl('长篇文章');
      if (q === 'template') navigate('#/templates');
      if (q === 'series') {
        const name = await UI.prompt('新建系列(合集)', { placeholder: '例如:World Model 入门系列' });
        if (name) {
          await Store.saveCollection({ name });
          const col = Store.state.collections[Store.state.collections.length - 1];
          const a = await Store.createArticle({ title: `${name} · 一` });
          await Store.addToCollection(col.id, a.id);
          navigate(`#/edit/${a.id}`);
        }
      }
    };
  }

  // ---------- categories management ----------

  function categoriesPage(container) {
    const countOf = (id) => Store.filterArticles({ categoryId: id }).length;
    const renderTree = (parentId, depth) => Store.childCategories(parentId).map((c) => `
      <div class="cat-row" data-cat="${c.id}" draggable="true" style="--depth:${depth}">
        <span class="cat-drag">${UI.icon('grip', 14)}</span>
        <button class="cat-icon" data-c="icon" title="设置图标">${c.icon ? UI.entityIcon(c.icon, 15) : UI.icon('folder', 15)}</button>
        <button class="cat-name${c.color ? ` c-${c.color}-text` : ''}" data-c="open">${esc(c.name)}</button>
        ${c.description ? `<span class="hint cat-desc">${esc(c.description)}</span>` : ''}
        <span class="cat-count">${countOf(c.id)}</span>
        <button class="icon-btn" data-c="add" title="新建子分类">${UI.icon('plus', 14)}</button>
        <button class="icon-btn" data-c="menu" title="更多">${UI.icon('dots', 14)}</button>
      </div>
      ${renderTree(c.id, depth + 1).join('')}`);

    container.innerHTML = `
      <header class="page-head">
        <div class="page-head-l"><h2>分类</h2><span class="page-count">${Store.state.categories.length} 个</span></div>
        <div class="page-head-r"><button class="btn btn-sm btn-primary" data-c="new">${UI.icon('plus', 14)} 新建分类</button></div>
      </header>
      <p class="hint page-hint">分类用于建立长期稳定的内容结构,支持多级嵌套。拖拽可排序,每篇文章可设一个主分类和多个辅助分类。</p>
      <div class="cat-tree">${renderTree('', 0).join('') || '<div class="empty-state small">还没有分类</div>'}</div>`;

    let dragId = '';
    container.querySelectorAll('.cat-row').forEach((row) => {
      row.addEventListener('dragstart', (e) => { dragId = row.dataset.cat; e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-after'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-after'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drop-after');
        const target = Store.category(row.dataset.cat);
        if (dragId && target && dragId !== target.id) {
          // drop as next sibling of target
          const siblings = Store.childCategories(target.parentId).filter((c) => c.id !== dragId);
          const idx = siblings.findIndex((c) => c.id === target.id);
          await Store.moveCategory(dragId, target.parentId, siblings[idx + 1]?.id || '');
        }
      });
    });

    container.onclick = async (e) => {
      const act = e.target.closest('[data-c]')?.dataset.c;
      const row = e.target.closest('[data-cat]');
      const cat = row ? Store.category(row.dataset.cat) : null;
      if (act === 'new') {
        const name = await UI.prompt('新建分类', { placeholder: '分类名称' });
        if (name) Store.saveCategory({ name });
      }
      if (!cat) return;
      if (act === 'open') navigate(`#/category/${cat.id}`);
      if (act === 'icon') UI.iconPick(e.target.closest('[data-c]'), (icon) => Store.saveCategory({ ...cat, icon }));
      if (act === 'add') {
        const name = await UI.prompt(`在「${cat.name}」下新建子分类`, { placeholder: '子分类名称' });
        if (name) Store.saveCategory({ name, parentId: cat.id });
      }
      if (act === 'menu') {
        UI.menu(e.target.closest('[data-c]'), [
          { label: '重命名', icon: 'pen', onClick: async () => {
            const name = await UI.prompt('重命名分类', { value: cat.name });
            if (name) Store.saveCategory({ ...cat, name });
          } },
          { label: '编辑描述', icon: 'type', onClick: async () => {
            const description = await UI.prompt('分类描述', { value: cat.description || '' });
            if (description != null) Store.saveCategory({ ...cat, description });
          } },
          { label: '设置颜色', icon: 'sparkle', onClick: () => {
            const body = UI.colorPicker(cat.color || '', (color) => { Store.saveCategory({ ...cat, color }); m.close(); });
            const m = UI.modal({ title: '分类颜色', body, width: 340 });
          } },
          { label: '移动到…', icon: 'folder', onClick: () => {
            const items = [{ label: '顶层', onClick: () => Store.moveCategory(cat.id, '') }];
            const walk = (pid, depth) => {
              for (const c of Store.childCategories(pid)) {
                if (c.id === cat.id || Store.categoryDescendants(cat.id).includes(c.id)) continue;
                items.push({ label: `${'    '.repeat(depth)}${c.name}`, onClick: () => Store.moveCategory(cat.id, c.id) });
                walk(c.id, depth + 1);
              }
            };
            walk('', 1);
            UI.menu(e.target.closest('[data-cat]'), items);
          } },
          { label: '合并到…', icon: 'layers', onClick: () => {
            const items = Store.state.categories.filter((c) => c.id !== cat.id).map((c) => ({
              label: Store.categoryPath(c.id),
              onClick: async () => {
                if (await UI.confirm('合并分类', `把「${cat.name}」下的文章全部移入「${c.name}」并删除「${cat.name}」?`)) Store.mergeCategory(cat.id, c.id);
              }
            }));
            UI.menu(e.target.closest('[data-cat]'), items.length ? items : [{ label: '没有其他分类', disabled: true }]);
          } },
          { sep: true },
          { label: '删除分类', icon: 'trash', danger: true, onClick: async () => {
            if (await UI.confirm('删除分类', `删除「${cat.name}」及其子分类?其中的文章不会被删除,会变为未分类。`, { danger: true })) Store.deleteCategory(cat.id);
          } }
        ], { align: 'right' });
      }
    };
  }

  // ---------- tags management ----------

  function tagsPage(container) {
    const tags = [...Store.state.tags].map((t) => ({ ...t, count: Store.tagUsage(t.name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    container.innerHTML = `
      <header class="page-head">
        <div class="page-head-l"><h2>标签</h2><span class="page-count">${tags.length} 个</span></div>
        <div class="page-head-r">
          <input class="input input-sm tag-search" placeholder="搜索标签…">
          <button class="btn btn-sm btn-primary" data-t="new">${UI.icon('plus', 14)} 新建标签</button>
        </div>
      </header>
      <p class="hint page-hint">标签描述文章的具体主题与属性,一篇文章可以有多个标签。重命名为已有标签名即可合并。</p>
      <div class="tag-table">
        ${tags.map((t) => `<div class="tag-trow" data-tag="${esc(t.name)}">
          <button class="tag-chip c-${t.color || 'gray'}" data-t="open">${esc(t.name)}</button>
          <span class="hint">${t.count} 篇文章</span>
          <span class="tag-tools">
            <button class="icon-btn" data-t="color" title="颜色">${UI.icon('sparkle', 14)}</button>
            <button class="icon-btn" data-t="rename" title="重命名 / 合并">${UI.icon('pen', 14)}</button>
            <button class="icon-btn" data-t="del" title="删除">${UI.icon('trash', 14)}</button>
          </span>
        </div>`).join('') || '<div class="empty-state small">还没有标签,在文章信息面板中添加</div>'}
      </div>`;

    container.querySelector('.tag-search')?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      container.querySelectorAll('.tag-trow').forEach((row) => {
        row.hidden = q && !row.dataset.tag.toLowerCase().includes(q);
      });
    });

    container.onclick = async (e) => {
      const act = e.target.closest('[data-t]')?.dataset.t;
      const row = e.target.closest('[data-tag]');
      const name = row?.dataset.tag;
      if (act === 'new') {
        const n = await UI.prompt('新建标签', { placeholder: '标签名称' });
        if (n) Store.ensureTag(n);
      }
      if (!name) return;
      if (act === 'open') navigate(`#/tag/${encodeURIComponent(name)}`);
      if (act === 'rename') {
        const n = await UI.prompt('重命名标签(输入已有标签名即可合并)', { value: name });
        if (n && n !== name) Store.renameTag(name, n);
      }
      if (act === 'color') {
        const tag = Store.tagByName(name);
        const body = UI.colorPicker(tag?.color || '', (color) => { Store.setTagColor(name, color); m.close(); });
        const m = UI.modal({ title: `标签「${name}」颜色`, body, width: 340 });
      }
      if (act === 'del' && await UI.confirm('删除标签', `删除标签「${name}」?会从所有文章上移除。`, { danger: true })) Store.deleteTag(name);
    };
  }

  // ---------- collections ----------

  function collectionsPage(container) {
    const cols = Store.state.collections;
    container.innerHTML = `
      <header class="page-head">
        <div class="page-head-l"><h2>合集</h2><span class="page-count">${cols.length} 个</span></div>
        <div class="page-head-r"><button class="btn btn-sm btn-primary" data-co="new">${UI.icon('plus', 14)} 新建合集</button></div>
      </header>
      <p class="hint page-hint">合集把需要一起阅读的文章组织成专题或系列:分类是文章放在哪里,标签是文章讲了什么,合集是哪些文章应该被一起读。</p>
      <div class="col-grid">
        ${cols.map((c) => {
          const done = c.items.filter((i) => ['done', 'archived'].includes(Store.article(i.articleId)?.status)).length;
          const coverUrl = Store.imageUrl(c.cover);
          return `<button class="col-card" data-col="${c.id}">
            <div class="col-cover">${coverUrl ? `<img src="${coverUrl}" alt="">` : `<span>${esc((c.name || '集').charAt(0))}</span>`}</div>
            <div class="col-body">
              <b>${esc(c.name)}</b>
              ${c.intro ? `<span class="hint">${esc(c.intro.slice(0, 50))}</span>` : ''}
              <span class="hint">${c.items.length} 篇 · 完成 ${done}/${c.items.length}</span>
              <div class="progress"><div class="progress-fill" style="width:${c.items.length ? Math.round((done / c.items.length) * 100) : 0}%"></div></div>
            </div>
          </button>`;
        }).join('') || '<div class="empty-state">还没有合集<br><span class="hint">用合集组织一个系列、专题或年度总结</span></div>'}
      </div>`;

    container.onclick = async (e) => {
      if (e.target.closest('[data-co="new"]')) {
        const name = await UI.prompt('新建合集', { placeholder: '例如:纽约旅行记录' });
        if (name) Store.saveCollection({ name });
        return;
      }
      const card = e.target.closest('[data-col]');
      if (card) navigate(`#/collection/${card.dataset.col}`);
    };
  }

  function collectionDetail(container, id) {
    const col = Store.collection(id);
    if (!col) { container.innerHTML = '<div class="empty-state">合集不存在</div>'; return; }
    const chapters = col.chapters || [];
    const itemArticle = (item) => Store.article(item.articleId);
    const items = col.items.filter(itemArticle);
    const done = items.filter((i) => ['done', 'archived'].includes(itemArticle(i).status)).length;
    const coverUrl = Store.imageUrl(col.cover);

    const itemRow = (item, idx) => {
      const a = itemArticle(item);
      return `<div class="col-item" data-idx="${idx}" draggable="true">
        <span class="cat-drag">${UI.icon('grip', 14)}</span>
        <span class="col-item-num">${idx + 1}</span>
        <div class="art-main">
          <div class="art-title">${esc(a.title || '未命名')}</div>
          <div class="art-meta">${UI.statusPill(a.status)}<span>${a.wordCount || 0} 字</span><span>${UI.fmtRelative(a.updatedAt)}</span></div>
        </div>
        <select class="input input-sm col-chapter" data-idx="${idx}" title="章节">
          <option value="">未分章</option>
          ${chapters.map((ch) => `<option value="${ch.id}" ${item.chapterId === ch.id ? 'selected' : ''}>${esc(ch.title)}</option>`).join('')}
        </select>
        <button class="icon-btn" data-ci="read" title="阅读">${UI.icon('eye', 15)}</button>
        <button class="icon-btn" data-ci="remove" title="移出合集">${UI.icon('x', 15)}</button>
      </div>`;
    };

    container.innerHTML = `
      <header class="col-head">
        <button class="col-head-cover" data-cd="cover" title="设置封面">${coverUrl ? `<img src="${coverUrl}" alt="">` : UI.icon('image', 24)}</button>
        <div class="col-head-main">
          <h2>${esc(col.name)}</h2>
          <p class="hint col-intro" data-cd="intro">${esc(col.intro || '点击添加合集简介…')}</p>
          <div class="art-meta"><span>${items.length} 篇文章</span><span>完成 ${done}/${items.length}</span></div>
          <div class="progress" style="max-width:220px"><div class="progress-fill" style="width:${items.length ? Math.round((done / items.length) * 100) : 0}%"></div></div>
        </div>
        <div class="page-head-r">
          <button class="btn btn-sm" data-cd="chapter">${UI.icon('plus', 13)} 章节</button>
          <button class="btn btn-sm" data-cd="add">${UI.icon('plus', 13)} 添加文章</button>
          <button class="btn btn-sm" data-cd="export">${UI.icon('download', 13)} 导出合集</button>
          <button class="icon-btn" data-cd="menu">${UI.icon('dots')}</button>
        </div>
      </header>
      ${chapters.length ? `<div class="col-chapters">${chapters.map((ch) => `<span class="filter-chip">${esc(ch.title)}<button data-chdel="${ch.id}">×</button></span>`).join('')}</div>` : ''}
      <div class="col-items">
        ${items.map(itemRow).join('') || '<div class="empty-state small">还没有文章,点击「添加文章」</div>'}
      </div>`;

    // drag reorder
    let dragIdx = -1;
    container.querySelectorAll('.col-item').forEach((row) => {
      row.addEventListener('dragstart', () => { dragIdx = Number(row.dataset.idx); });
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-after'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-after'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        const to = Number(row.dataset.idx);
        if (dragIdx >= 0 && to !== dragIdx) {
          const [moved] = col.items.splice(dragIdx, 1);
          col.items.splice(to, 0, moved);
          await Store.saveCollection(col);
        }
      });
    });

    container.querySelectorAll('.col-chapter').forEach((sel) => {
      sel.addEventListener('change', async () => {
        col.items[Number(sel.dataset.idx)].chapterId = sel.value;
        await Store.saveCollection(col);
      });
      sel.addEventListener('click', (e) => e.stopPropagation());
    });

    container.onclick = async (e) => {
      const chdel = e.target.closest('[data-chdel]');
      if (chdel) {
        col.chapters = chapters.filter((ch) => ch.id !== chdel.dataset.chdel);
        col.items.forEach((i) => { if (i.chapterId === chdel.dataset.chdel) i.chapterId = ''; });
        await Store.saveCollection(col);
        return;
      }
      const ci = e.target.closest('[data-ci]');
      if (ci) {
        const idx = Number(ci.closest('.col-item').dataset.idx);
        const item = col.items[idx];
        if (ci.dataset.ci === 'read') navigate(`#/read/${item.articleId}`);
        if (ci.dataset.ci === 'remove') Store.removeFromCollection(col.id, item.articleId);
        return;
      }
      const item = e.target.closest('.col-item');
      if (item && !e.target.closest('select')) { navigate(`#/edit/${col.items[Number(item.dataset.idx)].articleId}`); return; }

      const act = e.target.closest('[data-cd]')?.dataset.cd;
      if (act === 'intro') {
        const intro = await UI.prompt('合集简介', { value: col.intro || '' });
        if (intro != null) Store.saveCollection({ ...col, intro });
      }
      if (act === 'cover') {
        const files = await UI.pickFiles('image/*');
        if (files[0]) {
          const entry = await Store.addImage(files[0]);
          Store.saveCollection({ ...col, cover: `img:${entry.id}` });
        }
      }
      if (act === 'chapter') {
        const title = await UI.prompt('新建章节', { placeholder: '例如:第一部分 · 基础' });
        if (title) Store.saveCollection({ ...col, chapters: [...chapters, { id: MD.uid('ch'), title }] });
      }
      if (act === 'add') {
        const candidates = Store.liveArticles().filter((a) => !col.items.some((i) => i.articleId === a.id));
        UI.menu(e.target.closest('[data-cd]'), candidates.slice(0, 30).map((a) => ({
          label: a.title || '未命名', onClick: () => Store.addToCollection(col.id, a.id)
        })).concat(candidates.length ? [] : [{ label: '没有可添加的文章', disabled: true }]), { align: 'right', minWidth: 240 });
      }
      if (act === 'export') {
        const parts = [`# ${col.name}`, col.intro || ''];
        for (const i of items) {
          const a = itemArticle(i);
          parts.push('---', `# ${a.title || '未命名'}`, MD.blocksToMarkdown(a.blocks || []));
        }
        UI.download(`${col.name}.md`, parts.filter(Boolean).join('\n\n'), 'text/markdown;charset=utf-8');
        UI.toast('已导出整个合集', 'success');
      }
      if (act === 'menu') {
        UI.menu(e.target.closest('[data-cd]'), [
          { label: '重命名', icon: 'pen', onClick: async () => {
            const name = await UI.prompt('重命名合集', { value: col.name });
            if (name) Store.saveCollection({ ...col, name });
          } },
          { label: '删除合集', icon: 'trash', danger: true, onClick: async () => {
            if (await UI.confirm('删除合集', '只删除合集本身,其中的文章不受影响。', { danger: true })) {
              await Store.deleteCollection(col.id);
              navigate('#/collections');
            }
          } }
        ], { align: 'right' });
      }
    };
  }

  // ---------- image library ----------

  const libState = { q: '', folder: '', usage: '', time: '' };

  function libraryPage(container) {
    const usedIds = new Set();
    for (const a of Store.liveArticles()) {
      if (a.cover?.startsWith('img:')) usedIds.add(a.cover.slice(4));
      for (const b of a.blocks || []) {
        if (b.src?.startsWith('img:')) usedIds.add(b.src.slice(4));
        for (const item of b.items || []) if (item.src?.startsWith('img:')) usedIds.add(item.src.slice(4));
      }
    }
    const folders = [...new Set(Store.state.images.map((i) => i.folder).filter(Boolean))].sort();
    let images = [...Store.state.images].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (libState.q) {
      const q = libState.q.toLowerCase();
      images = images.filter((i) => i.name.toLowerCase().includes(q) || (i.tags || []).some((t) => t.toLowerCase().includes(q)));
    }
    if (libState.folder) images = images.filter((i) => i.folder === libState.folder);
    if (libState.usage === 'used') images = images.filter((i) => usedIds.has(i.id));
    if (libState.usage === 'unused') images = images.filter((i) => !usedIds.has(i.id));
    if (libState.time) {
      const cutoff = Date.now() - Number(libState.time) * 86400000;
      images = images.filter((i) => new Date(i.createdAt).getTime() >= cutoff);
    }

    container.innerHTML = `
      <header class="page-head">
        <div class="page-head-l"><h2>图片素材库</h2><span class="page-count">${images.length} 张 · ${UI.fmtBytes(images.reduce((s, i) => s + (i.size || 0), 0))}</span></div>
        <div class="page-head-r"><button class="btn btn-sm btn-primary" data-lib="upload">${UI.icon('upload', 14)} 上传图片</button></div>
      </header>
      <div class="lib-toolbar">
        <input class="input input-sm" data-lib="q" placeholder="搜索文件名 / 标签…" value="${esc(libState.q)}">
        <select class="input input-sm" data-lib="folder">
          <option value="">全部文件夹</option>
          ${folders.map((f) => `<option value="${esc(f)}" ${libState.folder === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
        </select>
        <select class="input input-sm" data-lib="usage">
          <option value="">全部图片</option>
          <option value="used" ${libState.usage === 'used' ? 'selected' : ''}>使用中</option>
          <option value="unused" ${libState.usage === 'unused' ? 'selected' : ''}>未被使用</option>
        </select>
        <select class="input input-sm" data-lib="time">
          <option value="">全部时间</option>
          <option value="7" ${libState.time === '7' ? 'selected' : ''}>最近 7 天</option>
          <option value="30" ${libState.time === '30' ? 'selected' : ''}>最近 30 天</option>
          <option value="365" ${libState.time === '365' ? 'selected' : ''}>最近一年</option>
        </select>
      </div>
      <div class="lib-grid">
        ${images.map((img) => `<button class="lib-cell" data-img="${img.id}">
          <img src="${Store.imageUrl(`img:${img.id}`)}" alt="" loading="lazy">
          <span class="lib-cell-meta">${esc(img.name)}${usedIds.has(img.id) ? '' : ' · <i>未使用</i>'}</span>
        </button>`).join('') || '<div class="empty-state">没有符合条件的图片<br><span class="hint">在编辑器中粘贴或拖入图片,会自动进入素材库</span></div>'}
      </div>`;

    container.querySelector('[data-lib="q"]').addEventListener('input', UI.debounce((e) => { libState.q = e.target.value; rerender(); }, 300));
    container.querySelectorAll('select[data-lib]').forEach((sel) => sel.addEventListener('change', () => { libState[sel.dataset.lib] = sel.value; rerender(); }));

    container.onclick = async (e) => {
      if (e.target.closest('[data-lib="upload"]')) {
        const files = await UI.pickFiles('image/*', true);
        for (const f of files) await Store.addImage(f, { folder: libState.folder });
        if (files.length) UI.toast(`已上传 ${files.length} 张图片`, 'success');
        return;
      }
      const cell = e.target.closest('[data-img]');
      if (cell) imageDetail(cell.dataset.img);
    };
  }

  function imageDetail(id) {
    const img = Store.image(id);
    if (!img) return;
    const usage = Store.imageUsage(id);
    const body = UI.el(`<div class="img-detail">
      <div class="img-detail-preview"><img src="${Store.imageUrl(`img:${id}`)}" alt=""></div>
      <div class="img-detail-form form-col">
        <label class="form-label">文件名</label><input class="input input-sm" data-if="name" value="${esc(img.name)}">
        <label class="form-label">文件夹</label><input class="input input-sm" data-if="folder" value="${esc(img.folder || '')}" placeholder="例如:旅行 / 2026">
        <label class="form-label">标签</label><div class="img-tags"></div>
        <div class="hint">${img.width}×${img.height} · ${UI.fmtBytes(img.size)} · ${UI.fmtDate(img.createdAt)}</div>
        <label class="form-label">被 ${usage.length} 篇文章使用</label>
        <div class="img-usage">${usage.map((a) => `<a href="#/edit/${a.id}">${esc(a.title || '未命名')}</a>`).join('') || '<span class="hint">未被使用</span>'}</div>
      </div>
    </div>`);
    body.querySelector('.img-tags').appendChild(UI.tagEditor(img.tags || [], (tags) => Store.updateImage(id, { tags })));
    body.querySelectorAll('[data-if]').forEach((input) => {
      input.addEventListener('change', () => Store.updateImage(id, { [input.dataset.if]: input.value.trim() }));
    });
    UI.modal({
      title: '图片详情', body, width: 720, cls: 'modal-img-detail',
      footer: [
        { label: '下载', close: false, onClick: () => { UI.download(img.name || 'image', img.blob); return false; } },
        { label: '替换图片(保留引用)', close: false, onClick: async () => {
          const files = await UI.pickFiles('image/*');
          if (files[0]) { await Store.replaceImage(id, files[0]); UI.toast('已替换,所有引用该图的文章自动更新', 'success'); }
          return false;
        } },
        { label: '删除', kind: 'btn-danger', onClick: async () => {
          if (usage.length && !(await UI.confirm('删除图片', `该图片仍被 ${usage.length} 篇文章使用,删除后文章中会显示空缺。确定删除?`, { danger: true }))) return;
          await Store.deleteImage(id);
        } },
        { label: '关闭', kind: 'btn-primary' }
      ]
    });
  }

  // ---------- templates ----------

  function templatesPage(container) {
    const tpls = Store.state.templates;
    container.innerHTML = `
      <header class="page-head">
        <div class="page-head-l"><h2>模板中心</h2><span class="page-count">${tpls.length} 个</span></div>
        <div class="page-head-r"><button class="btn btn-sm btn-primary" data-tp="new">${UI.icon('plus', 14)} 新建模板</button></div>
      </header>
      <p class="hint page-hint">从模板创建文章可以预设内容结构、分类、标签和状态。也可以在编辑器菜单里把现有文章「存为模板」。</p>
      <div class="tpl-grid">
        ${tpls.map((t) => `<div class="tpl-card" data-tpl="${t.id}">
          <span class="tpl-icon">${UI.entityIcon(t.icon, 20, 'file')}</span>
          <b>${esc(t.name)}</b>
          <span class="hint">${esc(t.description || '')}</span>
          <div class="tpl-acts">
            <button class="btn btn-xs btn-primary" data-tp="use">使用</button>
            <button class="btn btn-xs" data-tp="edit">编辑</button>
            <button class="icon-btn" data-tp="del" title="删除">${UI.icon('trash', 13)}</button>
          </div>
        </div>`).join('')}
      </div>`;

    container.onclick = async (e) => {
      const act = e.target.closest('[data-tp]')?.dataset.tp;
      const card = e.target.closest('[data-tpl]');
      const tpl = card ? Store.state.templates.find((t) => t.id === card.dataset.tpl) : null;
      if (act === 'new') return editTemplate(null);
      if (!tpl) return;
      if (act === 'use' || (!act && card)) {
        const a = await Store.createFromTemplate(tpl.id);
        navigate(`#/edit/${a.id}`);
      }
      if (act === 'edit') editTemplate(tpl);
      if (act === 'del' && await UI.confirm('删除模板', `删除模板「${tpl.name}」?`, { danger: true })) Store.deleteTemplate(tpl.id);
    };
  }

  function editTemplate(tpl) {
    const isNew = !tpl;
    const data = tpl ? JSON.parse(JSON.stringify(tpl)) : { name: '', icon: 'file', description: '', blocks: [MD.block('p')], defaults: {} };
    const body = UI.el(`<div class="form-col">
      <div class="form-row">
        <button class="btn tpl-icon-btn" data-te="icon">${UI.entityIcon(data.icon, 17, 'file')}</button>
        <input class="input" data-te="name" placeholder="模板名称" value="${esc(data.name)}" style="flex:1">
      </div>
      <input class="input input-sm" data-te="desc" placeholder="一句话描述" value="${esc(data.description || '')}">
      <label class="form-label">内容结构(Markdown)</label>
      <textarea class="input tpl-md" rows="10" spellcheck="false">${esc(MD.blocksToMarkdown(data.blocks || []))}</textarea>
      <div class="form-row">
        <div style="flex:1"><label class="form-label">默认状态</label>
          <select class="input input-sm" data-te="status">${Store.allStatuses().map((s) => `<option value="${s.id}" ${data.defaults?.status === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div style="flex:1"><label class="form-label">默认主题</label>
          <select class="input input-sm" data-te="theme"><option value="">跟随全局</option>${Reader.THEMES.map((t) => `<option value="${t.id}" ${data.defaults?.theme === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        </div>
      </div>
      <label class="form-label">默认标签</label><div class="tpl-tags"></div>
    </div>`);
    body.querySelector('.tpl-tags').appendChild(UI.tagEditor(data.defaults?.tags || [], (tags) => { data.defaults.tags = tags; }));
    body.querySelector('[data-te="icon"]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      UI.iconPick(btn, (icon) => { data.icon = icon || 'file'; btn.innerHTML = UI.entityIcon(data.icon, 17, 'file'); });
    });
    UI.modal({
      title: isNew ? '新建模板' : `编辑模板「${tpl.name}」`, body, width: 620,
      footer: [
        { label: '取消' },
        { label: '保存', kind: 'btn-primary', onClick: () => {
          data.name = body.querySelector('[data-te="name"]').value.trim() || '未命名模板';
          data.description = body.querySelector('[data-te="desc"]').value.trim();
          data.blocks = MD.parse(body.querySelector('.tpl-md').value);
          if (!data.blocks.length) data.blocks = [MD.block('p')];
          data.defaults = data.defaults || {};
          data.defaults.status = body.querySelector('[data-te="status"]').value;
          data.defaults.theme = body.querySelector('[data-te="theme"]').value;
          Store.saveTemplate(data);
        } }
      ]
    });
  }

  // ---------- trash ----------

  function trashPage(container) {
    const items = Store.trashedArticles().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    const days = Store.state.settings.trashDays || 30;
    container.innerHTML = `
      <header class="page-head">
        <div class="page-head-l"><h2>回收站</h2><span class="page-count">${items.length} 篇</span></div>
        <div class="page-head-r">${items.length ? `<button class="btn btn-sm btn-danger-ghost" data-tr="empty">清空回收站</button>` : ''}</div>
      </header>
      <p class="hint page-hint">回收站中的文章会在删除 ${days} 天后自动清除。</p>
      <div class="art-list">
        ${items.map((a) => `<div class="art-row trash-row" data-id="${a.id}">
          ${coverThumb(a)}
          <div class="art-main">
            <div class="art-title">${esc(a.title || '未命名')}</div>
            <div class="art-meta"><span>${a.wordCount || 0} 字</span><span>删除于 ${UI.fmtRelative(a.deletedAt)}</span></div>
          </div>
          <button class="btn btn-sm" data-tr="restore">恢复</button>
          <button class="btn btn-sm btn-danger-ghost" data-tr="purge">彻底删除</button>
        </div>`).join('') || '<div class="empty-state">回收站是空的</div>'}
      </div>`;

    container.onclick = async (e) => {
      const act = e.target.closest('[data-tr]')?.dataset.tr;
      const row = e.target.closest('[data-id]');
      if (act === 'empty' && await UI.confirm('清空回收站', `彻底删除全部 ${items.length} 篇文章?此操作不可撤销。`, { danger: true, okText: '全部删除' })) {
        for (const a of items) await Store.purgeArticle(a.id);
      }
      if (!row) return;
      if (act === 'restore') { await Store.restoreArticle(row.dataset.id); UI.toast('已恢复', 'success'); }
      if (act === 'purge' && await UI.confirm('彻底删除', '此操作不可撤销,确定彻底删除这篇文章?', { danger: true })) {
        await Store.purgeArticle(row.dataset.id);
      }
    };
  }

  // ---------- settings ----------

  function settingsPage(container) {
    const s = Store.state.settings;
    const themes = Reader.THEMES;
    container.innerHTML = `
      <header class="page-head"><div class="page-head-l"><h2>设置</h2></div></header>
      <div class="settings">
        <section>
          <h3>基本</h3>
          <div class="set-row"><label>作者名(用于导出署名)</label><input class="input input-sm" data-s="author" value="${esc(s.author || '')}" placeholder="你的名字"></div>
          <div class="set-row"><label>界面外观</label>
            <select class="input input-sm" data-s="uiTheme">
              <option value="auto" ${s.uiTheme === 'auto' ? 'selected' : ''}>跟随系统</option>
              <option value="light" ${s.uiTheme === 'light' ? 'selected' : ''}>浅色</option>
              <option value="dark" ${s.uiTheme === 'dark' ? 'selected' : ''}>深色</option>
            </select></div>
          <div class="set-row"><label>默认文章主题</label>
            <select class="input input-sm" data-s="defaultTheme">${themes.map((t) => `<option value="${t.id}" ${s.defaultTheme === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        </section>

        <section>
          <h3>编辑器</h3>
          <div class="set-row"><label>正文字体</label>
            <select class="input input-sm" data-s="editorFont"><option value="sans" ${s.editorFont === 'sans' ? 'selected' : ''}>黑体(无衬线)</option><option value="serif" ${s.editorFont === 'serif' ? 'selected' : ''}>宋体(衬线)</option></select></div>
          <div class="set-row"><label>字号</label><input class="input input-sm" type="number" min="14" max="22" data-s="editorFontSize" value="${s.editorFontSize}"></div>
          <div class="set-row"><label>行高</label><input class="input input-sm" type="number" min="1.5" max="2.2" step="0.1" data-s="lineHeight" value="${s.lineHeight}"></div>
          <div class="set-row"><label>正文宽度 (px)</label><input class="input input-sm" type="number" min="560" max="960" step="20" data-s="editorWidth" value="${s.editorWidth}"></div>
          <div class="set-row"><label>Markdown 快捷输入</label><input type="checkbox" data-s="mdInput" ${s.mdInput !== false ? 'checked' : ''}></div>
          <div class="set-row"><label>拼写检查</label><input type="checkbox" data-s="spellcheck" ${s.spellcheck ? 'checked' : ''}></div>
          <div class="set-row"><label>显示字数等写作信息</label><input type="checkbox" data-s="showMeta" ${s.showMeta !== false ? 'checked' : ''}></div>
          <div class="set-row"><label>专注模式打字机滚动</label><input type="checkbox" data-s="typewriter" ${s.typewriter ? 'checked' : ''}></div>
        </section>

        <section>
          <h3>图片</h3>
          <div class="set-row"><label>上传时压缩大图</label><input type="checkbox" data-s="imgCompress" ${s.imgCompress ? 'checked' : ''}></div>
          <div class="set-row"><label>最大宽度 (px)</label><input class="input input-sm" type="number" min="800" max="4000" step="100" data-s="imgMaxWidth" value="${s.imgMaxWidth}"></div>
          <div class="set-row"><label>压缩质量 (0.5–1)</label><input class="input input-sm" type="number" min="0.5" max="1" step="0.05" data-s="imgQuality" value="${s.imgQuality}"></div>
        </section>

        <section>
          <h3>写作状态</h3>
          <p class="hint">内置状态:${Store.STATUSES.map((x) => x.name).join('、')}。可添加自定义状态:</p>
          <div class="custom-status-list">
            ${(s.customStatuses || []).map((cs, i) => `<span class="status-pill c-${cs.color || 'gray'}">${esc(cs.name)}<button class="tag-remove" data-cs-del="${i}">×</button></span>`).join('')}
            <button class="btn btn-xs" data-set="add-status">${UI.icon('plus', 12)} 添加状态</button>
          </div>
        </section>

        <section>
          <h3>管理</h3>
          <div class="set-links">
            <a href="#/categories" class="btn btn-sm">分类管理</a>
            <a href="#/tags" class="btn btn-sm">标签管理</a>
            <a href="#/templates" class="btn btn-sm">模板管理</a>
            <a href="#/library" class="btn btn-sm">图片素材库</a>
          </div>
        </section>

        <section>
          <h3>数据</h3>
          <p class="hint">所有数据保存在本机浏览器(IndexedDB)中,不会上传到任何服务器。建议定期备份。</p>
          <div class="set-links">
            <button class="btn btn-sm btn-primary" data-set="backup">${UI.icon('download', 14)} 导出完整备份</button>
            <button class="btn btn-sm" data-set="restore">${UI.icon('upload', 14)} 从备份恢复</button>
            <button class="btn btn-sm" data-set="import">${UI.icon('upload', 14)} 导入文章</button>
          </div>
          <p class="hint" style="margin-top:10px">云端同步:接口已预留,当前版本为纯本地存储。</p>
        </section>

        <section>
          <h3>插件(默认关闭)</h3>
          <div class="set-row"><label>AI 写作助手(未来可选插件)</label><input type="checkbox" data-s="aiPlugin" disabled></div>
          <p class="hint">本产品的全部功能都不依赖任何外部 API。AI 能力将来会以可选插件形式提供,默认保持关闭。</p>
        </section>
      </div>`;

    container.querySelectorAll('[data-s]').forEach((input) => {
      input.addEventListener('change', () => {
        let value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.type === 'number') value = Number(input.value);
        Store.saveSettings({ [input.dataset.s]: value });
        if (input.dataset.s === 'uiTheme') App.applyUiTheme();
      });
    });

    container.onclick = async (e) => {
      const del = e.target.closest('[data-cs-del]');
      if (del) {
        const list = [...(s.customStatuses || [])];
        list.splice(Number(del.dataset.csDel), 1);
        Store.saveSettings({ customStatuses: list });
        return;
      }
      const act = e.target.closest('[data-set]')?.dataset.set;
      if (act === 'add-status') {
        const name = await UI.prompt('自定义状态', { placeholder: '例如:待配图' });
        if (name) Store.saveSettings({ customStatuses: [...(s.customStatuses || []), { id: `custom_${MD.uid()}`, name, color: 'teal' }] });
      }
      if (act === 'backup') {
        UI.toast('正在打包备份…');
        const data = await Store.exportBackup();
        UI.download(`plume-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
        UI.toast('备份已导出', 'success');
      }
      if (act === 'restore') {
        const files = await UI.pickFiles('.json');
        if (!files[0]) return;
        if (!(await UI.confirm('从备份恢复', '恢复会覆盖当前的全部数据。确定继续?', { danger: true, okText: '覆盖并恢复' }))) return;
        try {
          await Store.importBackup(JSON.parse(await UI.readAsText(files[0])));
          UI.toast('恢复完成', 'success');
        } catch (err) {
          UI.toast(`恢复失败:${err.message}`, 'error');
        }
      }
      if (act === 'import') Exporter.importDialog();
    };
  }

  // ---------- router entry ----------

  function render(container, route) {
    pageState.selecting = false;
    pageState.selected.clear();
    const [, page, param] = route.split('/');
    rerender = () => render(container, route);

    // filters reset when navigating between list scopes
    if (render.lastPage !== page + (param || '')) { pageState.filter = {}; }
    render.lastPage = page + (param || '');

    switch (page) {
      case 'home': case '': dashboard(container); break;
      case 'articles': listPage(container, { title: '全部文章', route, baseFilter: {} }); break;
      case 'recent': listPage(container, { title: '最近编辑', route, baseFilter: { updatedWithinDays: 7 }, emptyText: '最近 7 天没有编辑过文章' }); break;
      case 'drafts': listPage(container, { title: '草稿箱', route, baseFilter: { statuses: ['idea', 'draft', 'writing', 'revising'] }, emptyText: '没有进行中的草稿' }); break;
      case 'favorites': listPage(container, { title: '收藏', route, baseFilter: { favorite: true }, emptyText: '还没有收藏的文章', showNew: false }); break;
      case 'category': {
        const cat = Store.category(param);
        listPage(container, { title: cat ? Store.categoryPath(cat.id) : '分类', route, baseFilter: { categoryId: param } });
        break;
      }
      case 'tag': listPage(container, { title: `# ${decodeURIComponent(param || '')}`, route, baseFilter: { tags: [decodeURIComponent(param || '')] }, showNew: false }); break;
      case 'view': {
        const view = Store.state.views.find((v) => v.id === param);
        listPage(container, { title: view ? view.name : '智能视图', route, baseFilter: view?.filter || {}, showNew: false });
        break;
      }
      case 'categories': categoriesPage(container); break;
      case 'tags': tagsPage(container); break;
      case 'collections': collectionsPage(container); break;
      case 'collection': collectionDetail(container, param); break;
      case 'library': libraryPage(container); break;
      case 'templates': templatesPage(container); break;
      case 'trash': trashPage(container); break;
      case 'settings': settingsPage(container); break;
      default: dashboard(container);
    }
  }

  return { render };
})();
