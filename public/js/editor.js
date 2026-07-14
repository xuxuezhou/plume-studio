/* Block editor. Global: Editor
 * Editor.open(container, articleId) renders the full editing surface and
 * returns an instance with destroy().
 */
const Editor = (() => {
  const TEXT_TYPES = MD.TEXT_TYPES;

  const TYPE_LABELS = {
    p: '正文', h1: '标题 1', h2: '标题 2', h3: '标题 3', quote: '引用',
    ul: '无序列表', ol: '有序列表', todo: '待办', callout: '提示块', toggle: '折叠内容',
    divider: '分割线', code: '代码块', math: '数学公式', table: '表格',
    image: '图片', gallery: '多图排版', columns: '双栏布局'
  };

  const CALLOUT_META = {
    info: { icon: 'info', name: '信息' }, tip: { icon: 'bulb', name: '提示' },
    warning: { icon: 'warning', name: '注意' }, danger: { icon: 'danger', name: '警告' }, note: { icon: 'pin', name: '备注' }
  };

  // ---------- caret helpers ----------

  function caretOffset(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    return range.toString().length;
  }

  function setCaret(el, offset = 0) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    let remaining = offset;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    if (!node) { range.selectNodeContents(el); range.collapse(offset !== 0 ? false : true); }
    else {
      let placed = false;
      while (node) {
        if (remaining <= node.length) { range.setStart(node, Math.max(0, remaining)); placed = true; break; }
        remaining -= node.length;
        node = walker.nextNode();
      }
      if (!placed) { range.selectNodeContents(el); range.collapse(false); }
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function splitAtCaret(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [el.innerHTML, ''];
    const caret = sel.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(caret.startContainer, caret.startOffset);
    const after = document.createRange();
    after.selectNodeContents(el);
    after.setStart(caret.endContainer, caret.endOffset);
    const serialize = (range) => {
      const div = document.createElement('div');
      div.appendChild(range.cloneContents());
      return div.innerHTML;
    };
    return [serialize(before), serialize(after)];
  }

  function caretOnEdge(el, edge) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const rects = sel.getRangeAt(0).getClientRects();
    const elRect = el.getBoundingClientRect();
    if (!rects.length) return true;
    const r = rects[0];
    return edge === 'top' ? r.top - elRect.top < 10 : elRect.bottom - r.bottom < 10;
  }

  // ---------- instance ----------

  function open(container, articleId, opts = {}) {
    const article = Store.article(articleId);
    if (!article) { container.innerHTML = '<div class="empty-state">文章不存在</div>'; return { destroy() {} }; }

    const inst = {
      id: articleId,
      article,
      undoStack: [], redoStack: [],
      saveState: 'saved', // saving | saved | failed | offline
      focusMode: false,
      panelOpen: false,
      destroyed: false,
      selectedBlockId: '',
      opts
    };

    const settings = Store.state.settings;

    // ---------- scaffold ----------

    container.innerHTML = '';
    const shell = UI.el(`<div class="editor-shell">
      <div class="editor-topbar">
        <div class="etb-left">
          <button class="icon-btn" data-act="back" title="返回">${UI.icon('back')}</button>
          <span class="etb-crumb"></span>
        </div>
        <div class="etb-right">
          <span class="etb-save"></span>
          <button class="icon-btn" data-act="history" title="版本历史">${UI.icon('history')}</button>
          <button class="icon-btn" data-act="read" title="阅读预览">${UI.icon('eye')}</button>
          <button class="icon-btn" data-act="focus" title="专注模式">${UI.icon('focus')}</button>
          <button class="icon-btn" data-act="panel" title="文章信息">${UI.icon('sidebar')}</button>
          <button class="icon-btn" data-act="more" title="更多">${UI.icon('dots')}</button>
        </div>
      </div>
      <div class="editor-main">
        <div class="editor-scroll">
          <div class="editor-page">
            <div class="editor-cover" hidden><img alt=""><button class="cover-remove icon-btn">${UI.icon('x', 14)}</button></div>
            <div class="editor-title" contenteditable="true" data-ph="无标题"></div>
            <div class="editor-metaline"></div>
            <div class="editor-blocks"></div>
            <div class="editor-tail"></div>
          </div>
        </div>
        <aside class="editor-panel" hidden></aside>
      </div>
      <div class="editor-footbar"><span class="efb-stats"></span></div>
    </div>`);
    container.appendChild(shell);

    const els = {
      shell,
      topbar: shell.querySelector('.editor-topbar'),
      crumb: shell.querySelector('.etb-crumb'),
      saveEl: shell.querySelector('.etb-save'),
      scroll: shell.querySelector('.editor-scroll'),
      page: shell.querySelector('.editor-page'),
      cover: shell.querySelector('.editor-cover'),
      title: shell.querySelector('.editor-title'),
      metaline: shell.querySelector('.editor-metaline'),
      blocks: shell.querySelector('.editor-blocks'),
      tail: shell.querySelector('.editor-tail'),
      panel: shell.querySelector('.editor-panel'),
      footStats: shell.querySelector('.efb-stats')
    };

    els.page.style.maxWidth = `${settings.editorWidth || 720}px`;
    els.blocks.style.fontSize = `${settings.editorFontSize || 17}px`;
    els.blocks.style.lineHeight = settings.lineHeight || 1.8;
    els.blocks.classList.toggle('font-serif', settings.editorFont === 'serif');
    els.blocks.spellcheck = Boolean(settings.spellcheck);

    // ---------- persistence ----------

    const CACHE_KEY = `plume-cache-${articleId}`;

    function snapshotDoc() {
      return JSON.stringify({ title: article.title, blocks: article.blocks });
    }

    function setSaveState(state) {
      inst.saveState = state;
      const map = { saving: '正在保存…', saved: '已保存', failed: '保存失败', offline: '离线保存', dirty: '' };
      els.saveEl.textContent = map[state] ?? '';
      els.saveEl.className = `etb-save save-${state}`;
    }

    const persist = UI.debounce(async () => {
      if (inst.destroyed) return;
      setSaveState('saving');
      try {
        await Store.updateArticle(articleId, { title: article.title, digest: article.digest, blocks: article.blocks, cover: article.cover });
        localStorage.removeItem(CACHE_KEY);
        if (!inst.destroyed) setSaveState('saved');
      } catch {
        // keep the crash-cache copy so nothing is lost
        if (!inst.destroyed) setSaveState(navigator.onLine === false ? 'offline' : 'failed');
      }
      renderFootStats();
    }, 700);

    function cacheLocally() {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), title: article.title, blocks: article.blocks }));
      } catch { /* quota — ignore */ }
    }

    function changed({ structural = false } = {}) {
      cacheLocally();
      setSaveState('saving');
      persist();
      if (structural) pushUndo();
      else pushUndoDebounced();
    }

    // crash recovery
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cache && cache.ts > new Date(article.updatedAt).getTime() + 3000) {
        UI.confirm('发现未保存的内容', '检测到上次编辑时有未保存的更改(可能因浏览器意外关闭)。要恢复吗?', { okText: '恢复' })
          .then((yes) => {
            if (yes) {
              article.title = cache.title;
              article.blocks = cache.blocks;
              renderAll();
              changed({ structural: true });
            } else {
              localStorage.removeItem(CACHE_KEY);
            }
          });
      }
    } catch { /* ignore */ }

    // ---------- undo / redo ----------

    function pushUndo() {
      const snap = snapshotDoc();
      if (inst.undoStack[inst.undoStack.length - 1] === snap) return;
      inst.undoStack.push(snap);
      if (inst.undoStack.length > 100) inst.undoStack.shift();
      inst.redoStack = [];
    }
    const pushUndoDebounced = UI.debounce(pushUndo, 900);

    function applySnap(snap) {
      const data = JSON.parse(snap);
      article.title = data.title;
      article.blocks = data.blocks;
      renderAll();
      cacheLocally();
      persist();
    }

    function undo() {
      if (inst.undoStack.length < 2) return;
      inst.redoStack.push(inst.undoStack.pop());
      applySnap(inst.undoStack[inst.undoStack.length - 1]);
    }
    function redo() {
      if (!inst.redoStack.length) return;
      const snap = inst.redoStack.pop();
      inst.undoStack.push(snap);
      applySnap(snap);
    }

    // ---------- block model ops ----------

    const blockIndex = (id) => article.blocks.findIndex((b) => b.id === id);
    const getBlock = (id) => article.blocks[blockIndex(id)] || null;

    function insertBlock(block, afterId = null) {
      const idx = afterId ? blockIndex(afterId) + 1 : article.blocks.length;
      article.blocks.splice(idx, 0, block);
      const el = renderBlock(block);
      const anchor = afterId ? els.blocks.querySelector(`[data-id="${afterId}"]`) : null;
      if (anchor) anchor.after(el);
      else els.blocks.appendChild(el);
      changed({ structural: true });
      return el;
    }

    function removeBlock(id, { keepOne = true } = {}) {
      const idx = blockIndex(id);
      if (idx < 0) return;
      article.blocks.splice(idx, 1);
      els.blocks.querySelector(`[data-id="${id}"]`)?.remove();
      if (keepOne && article.blocks.length === 0) {
        const p = MD.block('p');
        article.blocks.push(p);
        els.blocks.appendChild(renderBlock(p));
      }
      changed({ structural: true });
    }

    function replaceBlockEl(block) {
      const old = els.blocks.querySelector(`[data-id="${block.id}"]`);
      const fresh = renderBlock(block);
      if (old) old.replaceWith(fresh);
      return fresh;
    }

    function moveBlock(id, targetId, before) {
      if (id === targetId) return;
      const idx = blockIndex(id);
      const [block] = article.blocks.splice(idx, 1);
      let tIdx = blockIndex(targetId);
      if (!before) tIdx += 1;
      article.blocks.splice(tIdx, 0, block);
      const el = els.blocks.querySelector(`[data-id="${id}"]`);
      const target = els.blocks.querySelector(`[data-id="${targetId}"]`);
      if (el && target) before ? target.before(el) : target.after(el);
      changed({ structural: true });
    }

    function convertBlock(id, type, extra = {}) {
      const b = getBlock(id);
      if (!b) return;
      const text = b.text || '';
      const keys = Object.keys(b).filter((k) => !['id', 'type'].includes(k));
      for (const k of keys) delete b[k];
      b.type = type;
      if (TEXT_TYPES.has(type)) b.text = text;
      if (type === 'callout') b.variant = extra.variant || 'info';
      if (type === 'toggle') b.summary = extra.summary || '详情';
      if (type === 'code') { b.code = MD.plainText(text); b.lang = ''; }
      if (type === 'math') b.tex = MD.plainText(text);
      if (type === 'table') { b.rows = [[text || '', ''], ['', '']]; b.header = true; }
      if (type === 'columns') b.cols = [{ text }, { text: '' }];
      if (type === 'image') Object.assign(b, { src: '', alt: '', caption: '', title: '', layout: 'center', width: 100, radius: 6 }, extra);
      if (type === 'gallery') Object.assign(b, { items: [], layout: 'grid2' }, extra);
      Object.assign(b, extra);
      const el = replaceBlockEl(b);
      changed({ structural: true });
      const editable = el.querySelector('[contenteditable]');
      if (editable) setCaret(editable, 0);
      return el;
    }

    // ---------- rendering ----------

    function renderAll() {
      els.title.textContent = article.title || '';
      renderCover();
      renderMetaline();
      els.blocks.innerHTML = '';
      if (!article.blocks?.length) article.blocks = [MD.block('p')];
      for (const b of article.blocks) els.blocks.appendChild(renderBlock(b));
      renderFootStats();
      renderCrumb();
    }

    function renderCrumb() {
      const path = Store.categoryPath(article.categoryId);
      els.crumb.textContent = path || '未分类';
    }

    function renderCover() {
      const url = Store.imageUrl(article.cover);
      els.cover.hidden = !url;
      if (url) els.cover.querySelector('img').src = url;
    }

    function renderMetaline() {
      const cat = Store.category(article.categoryId);
      els.metaline.innerHTML = `
        <button class="meta-chip" data-meta="category">${UI.icon('folder', 13)} ${UI.esc(cat ? Store.categoryPath(cat.id) : '选择分类')}</button>
        <button class="meta-chip" data-meta="status">${UI.statusPill(article.status)}</button>
        <span class="meta-tags">${(article.tags || []).map((t) => UI.tagChip(t)).join('')}</span>
        <button class="meta-chip meta-add" data-meta="tags">${UI.icon('plus', 12)} 标签</button>
      `;
    }

    function renderFootStats() {
      if (!Store.state.settings.showMeta) { els.footStats.innerHTML = ''; return; }
      const s = MD.stats(article.blocks);
      const target = article.targetWords > 0
        ? ` · 目标 ${Math.min(100, Math.round((s.words / article.targetWords) * 100))}%`
        : '';
      els.footStats.innerHTML = [
        `${s.words} 字`, `${s.chars} 字符`, `${s.paragraphs} 段`, `约 ${s.readMinutes} 分钟`,
        `创建 ${UI.fmtDate(article.createdAt)}`, `更新 ${UI.fmtRelative(article.updatedAt)}`
      ].join(' · ') + target;
    }

    function gutterHtml() {
      return `<div class="eb-gutter" contenteditable="false">
        <button class="eb-add" tabindex="-1" title="插入内容">${UI.icon('plus', 15)}</button>
        <button class="eb-drag" tabindex="-1" draggable="true" title="拖拽移动 · 点击打开菜单">${UI.icon('grip', 15)}</button>
      </div>`;
    }

    function renderBlock(b) {
      const wrap = UI.el(`<div class="eb ebt-${b.type}" data-id="${b.id}" data-type="${b.type}">${gutterHtml()}<div class="eb-body"></div></div>`);
      const body = wrap.querySelector('.eb-body');
      if (b.align && b.align !== 'left') body.style.textAlign = b.align;

      const editable = (cls, html, ph) =>
        UI.el(`<div class="eb-text ${cls || ''}" contenteditable="true" data-ph="${ph || ''}">${html || ''}</div>`);

      switch (b.type) {
        case 'p': body.appendChild(editable('', b.text, '输入内容,或按 + 插入…')); break;
        case 'h1': case 'h2': case 'h3': body.appendChild(editable(`eb-heading ${b.type}`, b.text, TYPE_LABELS[b.type])); break;
        case 'quote': body.appendChild(editable('eb-quote', b.text, '引用')); break;
        case 'ul': body.appendChild(UI.el('<span class="eb-bullet">•</span>')); body.appendChild(editable('eb-li', b.text, '列表项')); break;
        case 'ol': {
          let n = 1;
          const idx = blockIndex(b.id);
          for (let i = idx - 1; i >= 0 && article.blocks[i].type === 'ol'; i--) n++;
          body.appendChild(UI.el(`<span class="eb-bullet eb-num">${n}.</span>`));
          body.appendChild(editable('eb-li', b.text, '列表项'));
          break;
        }
        case 'todo': {
          const box = UI.el(`<button class="eb-todo-box${b.checked ? ' done' : ''}" contenteditable="false">${b.checked ? UI.icon('check', 12) : ''}</button>`);
          box.addEventListener('click', () => {
            b.checked = !b.checked;
            replaceBlockEl(b);
            changed({ structural: true });
          });
          body.appendChild(box);
          body.appendChild(editable(`eb-li${b.checked ? ' eb-done' : ''}`, b.text, '待办事项'));
          break;
        }
        case 'callout': {
          const meta = CALLOUT_META[b.variant] || CALLOUT_META.info;
          const iconBtn = UI.el(`<button class="eb-callout-icon" contenteditable="false" title="切换类型">${UI.icon(meta.icon, 15)}</button>`);
          iconBtn.addEventListener('click', () => {
            UI.menu(iconBtn, Object.entries(CALLOUT_META).map(([variant, m]) => ({
              label: m.name, icon: m.icon, checked: b.variant === variant,
              onClick: () => { b.variant = variant; replaceBlockEl(b); changed({ structural: true }); }
            })));
          });
          const inner = UI.el(`<div class="eb-callout c-${b.variant || 'info'}"></div>`);
          inner.appendChild(iconBtn);
          inner.appendChild(editable('eb-callout-text', b.text, '提示内容'));
          body.appendChild(inner);
          break;
        }
        case 'toggle': {
          const details = UI.el(`<div class="eb-toggle${b.open ? ' open' : ''}"></div>`);
          const head = UI.el(`<div class="eb-toggle-head" contenteditable="false"><button class="eb-toggle-arrow">${UI.icon('chevronRight', 14)}</button></div>`);
          const summary = UI.el(`<div class="eb-text eb-toggle-summary" contenteditable="true" data-ph="折叠标题">${UI.esc(b.summary || '')}</div>`);
          summary.addEventListener('input', () => { b.summary = summary.textContent; changed(); });
          head.appendChild(summary);
          head.querySelector('.eb-toggle-arrow').addEventListener('click', () => {
            b.open = !b.open;
            details.classList.toggle('open', b.open);
          });
          details.appendChild(head);
          const bodyEl = editable('eb-toggle-body', b.text, '折叠内容…');
          details.appendChild(bodyEl);
          body.appendChild(details);
          break;
        }
        case 'divider': body.innerHTML = '<hr class="eb-hr">'; break;
        case 'code': {
          const box = UI.el(`<div class="eb-code" contenteditable="false">
            <input class="eb-code-lang" value="${UI.esc(b.lang || '')}" placeholder="语言" spellcheck="false">
            <textarea class="eb-code-text" spellcheck="false" placeholder="代码…"></textarea>
          </div>`);
          const ta = box.querySelector('textarea');
          ta.value = b.code || '';
          const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
          ta.addEventListener('input', () => { b.code = ta.value; grow(); changed(); });
          ta.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
            e.stopPropagation();
          });
          box.querySelector('.eb-code-lang').addEventListener('input', (e) => { b.lang = e.target.value; changed(); });
          body.appendChild(box);
          requestAnimationFrame(grow);
          break;
        }
        case 'math': {
          const box = UI.el(`<div class="eb-math" contenteditable="false">
            <textarea class="eb-math-text" spellcheck="false" placeholder="LaTeX 公式,例如 E = mc^2"></textarea>
            <div class="eb-math-preview"></div>
          </div>`);
          const ta = box.querySelector('textarea');
          const preview = box.querySelector('.eb-math-preview');
          ta.value = b.tex || '';
          const update = () => {
            preview.textContent = b.tex || '';
            preview.classList.toggle('empty', !b.tex);
            ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`;
          };
          ta.addEventListener('input', () => { b.tex = ta.value; update(); changed(); });
          ta.addEventListener('keydown', (e) => e.stopPropagation());
          body.appendChild(box);
          requestAnimationFrame(update);
          break;
        }
        case 'table': renderTable(b, body); break;
        case 'image': renderImage(b, body); break;
        case 'gallery': renderGallery(b, body); break;
        case 'columns': {
          const box = UI.el('<div class="eb-columns" contenteditable="false"></div>');
          for (const col of b.cols || []) {
            const cell = editable('eb-col', col.text, '栏内容…');
            cell.addEventListener('input', () => { col.text = MD.sanitizeInline(cell.innerHTML); changed(); });
            box.appendChild(cell);
          }
          body.appendChild(box);
          break;
        }
        default: body.appendChild(editable('', b.text || '', ''));
      }

      // gutter actions
      wrap.querySelector('.eb-add').addEventListener('click', (e) => openInsertMenu(e.currentTarget, b.id));
      const drag = wrap.querySelector('.eb-drag');
      drag.addEventListener('click', (e) => openBlockMenu(e.currentTarget, b.id));
      drag.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plume-block', b.id);
        e.dataTransfer.effectAllowed = 'move';
        wrap.classList.add('dragging');
      });
      drag.addEventListener('dragend', () => {
        wrap.classList.remove('dragging');
        els.blocks.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      });
      return wrap;
    }

    // ---------- table ----------

    function renderTable(b, body) {
      const wrap = UI.el('<div class="eb-table" contenteditable="false"></div>');
      const table = document.createElement('table');
      (b.rows || []).forEach((row, ri) => {
        const tr = document.createElement('tr');
        row.forEach((cellHtml, ci) => {
          const cell = document.createElement(b.header && ri === 0 ? 'th' : 'td');
          cell.contentEditable = 'true';
          cell.innerHTML = cellHtml || '';
          cell.addEventListener('input', () => { b.rows[ri][ci] = MD.sanitizeInline(cell.innerHTML); changed(); });
          cell.addEventListener('keydown', (e) => e.stopPropagation());
          tr.appendChild(cell);
        });
        table.appendChild(tr);
      });
      const tools = UI.el(`<div class="eb-table-tools">
        <button data-t="row">+ 行</button><button data-t="col">+ 列</button>
        <button data-t="delrow">- 行</button><button data-t="delcol">- 列</button>
      </div>`);
      tools.addEventListener('click', (e) => {
        const act = e.target.closest('button')?.dataset.t;
        if (!act) return;
        const cols = b.rows[0]?.length || 2;
        if (act === 'row') b.rows.push(Array(cols).fill(''));
        if (act === 'col') b.rows.forEach((r) => r.push(''));
        if (act === 'delrow' && b.rows.length > 1) b.rows.pop();
        if (act === 'delcol' && cols > 1) b.rows.forEach((r) => r.pop());
        replaceBlockEl(b);
        changed({ structural: true });
      });
      wrap.appendChild(table);
      wrap.appendChild(tools);
      body.appendChild(wrap);
    }

    // ---------- images ----------

    async function pickAndAddImages() {
      const files = await UI.pickFiles('image/*', true);
      const ids = [];
      for (const f of files) {
        const entry = await Store.addImage(f);
        ids.push(`img:${entry.id}`);
      }
      return ids;
    }

    function libraryPicker(onPick, { multiple = false } = {}) {
      const picked = new Set();
      const body = UI.el('<div class="lib-picker"><div class="lib-picker-grid"></div></div>');
      const grid = body.querySelector('.lib-picker-grid');
      const images = [...Store.state.images].sort((a, b2) => b2.createdAt.localeCompare(a.createdAt));
      if (!images.length) grid.innerHTML = '<div class="empty-state small">素材库还没有图片</div>';
      for (const img of images) {
        const cell = UI.el(`<button class="lib-picker-cell"><img src="${Store.imageUrl(`img:${img.id}`)}" alt=""></button>`);
        cell.addEventListener('click', () => {
          if (multiple) {
            cell.classList.toggle('picked');
            picked.has(img.id) ? picked.delete(img.id) : picked.add(img.id);
          } else {
            m.close();
            onPick([`img:${img.id}`]);
          }
        });
        grid.appendChild(cell);
      }
      const m = UI.modal({
        title: '从素材库选择', body, width: 640,
        footer: multiple ? [
          { label: '取消' },
          { label: '插入所选', kind: 'btn-primary', onClick: () => { if (picked.size) onPick([...picked].map((id) => `img:${id}`)); } }
        ] : null
      });
    }

    function renderImage(b, body) {
      const box = UI.el('<figure class="eb-image" contenteditable="false"></figure>');
      const url = Store.imageUrl(b.src);
      if (!url) {
        const placeholder = UI.el(`<div class="eb-image-empty">
          <button data-p="upload">${UI.icon('upload', 15)} 上传图片</button>
          <button data-p="library">${UI.icon('image', 15)} 素材库</button>
          <button data-p="link">${UI.icon('link', 15)} 图片链接</button>
        </div>`);
        placeholder.addEventListener('click', async (e) => {
          const act = e.target.closest('button')?.dataset.p;
          if (act === 'upload') {
            const ids = await pickAndAddImages();
            if (ids.length === 1) { b.src = ids[0]; }
            else if (ids.length > 1) { Object.assign(b, { type: 'gallery', items: ids.map((src) => ({ src, caption: '' })), layout: 'grid2' }); delete b.src; }
            replaceBlockEl(b); changed({ structural: true });
          }
          if (act === 'library') libraryPicker((ids) => { b.src = ids[0]; replaceBlockEl(b); changed({ structural: true }); });
          if (act === 'link') {
            const link = await UI.prompt('图片链接', { placeholder: 'https://…' });
            if (link) { b.src = link; replaceBlockEl(b); changed({ structural: true }); }
          }
        });
        box.appendChild(placeholder);
        body.appendChild(box);
        return;
      }

      box.classList.add(`layout-${b.layout || 'center'}`);
      if (b.width && b.width < 100 && !['left', 'right'].includes(b.layout)) box.style.width = `${b.width}%`;
      const img = UI.el(`<img src="${url}" alt="${UI.esc(b.alt || '')}">`);
      const style = [];
      if (b.radius != null) style.push(`border-radius:${b.radius}px`);
      if (b.border) style.push('border:1px solid var(--border)');
      if (b.shadow) style.push('box-shadow:0 12px 32px rgba(30,26,20,.16)');
      if (b.bg) style.push(`background:${b.bg};padding:14px`);
      img.style.cssText = style.join(';');
      box.appendChild(img);

      // caption line (editable)
      const cap = UI.el(`<figcaption><input class="eb-cap-title" placeholder="图片标题" value="${UI.esc(b.title || '')}"><input class="eb-cap-text" placeholder="图片说明" value="${UI.esc(b.caption || '')}"></figcaption>`);
      cap.querySelector('.eb-cap-title').addEventListener('input', (e) => { b.title = e.target.value; changed(); });
      cap.querySelector('.eb-cap-text').addEventListener('input', (e) => { b.caption = e.target.value; changed(); });
      cap.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
      box.appendChild(cap);

      // hover toolbar
      const bar = UI.el(`<div class="eb-image-bar">
        <button data-i="layout" title="布局">${UI.icon('columns', 14)}</button>
        <button data-i="style" title="样式">${UI.icon('sparkle', 14)}</button>
        <button data-i="edit" title="裁剪 / 旋转">${UI.icon('crop', 14)}</button>
        <button data-i="meta" title="图片信息">${UI.icon('pen', 14)}</button>
        <button data-i="replace" title="替换">${UI.icon('restore', 14)}</button>
      </div>`);
      bar.addEventListener('click', (e) => {
        const act = e.target.closest('button')?.dataset.i;
        if (act === 'layout') {
          UI.menu(e.target.closest('button'), [
            { label: '居中', checked: (b.layout || 'center') === 'center', onClick: () => setImg({ layout: 'center' }) },
            { label: '突出版心', checked: b.layout === 'wide', onClick: () => setImg({ layout: 'wide' }) },
            { label: '全宽', checked: b.layout === 'full', onClick: () => setImg({ layout: 'full' }) },
            { label: '左浮动(文字环绕)', checked: b.layout === 'left', onClick: () => setImg({ layout: 'left' }) },
            { label: '右浮动(文字环绕)', checked: b.layout === 'right', onClick: () => setImg({ layout: 'right' }) },
            { sep: true },
            { label: '原始尺寸 100%', checked: !b.width || b.width === 100, onClick: () => setImg({ width: 100 }) },
            { label: '宽度 75%', checked: b.width === 75, onClick: () => setImg({ width: 75 }) },
            { label: '宽度 50%', checked: b.width === 50, onClick: () => setImg({ width: 50 }) },
            { label: '宽度 33%', checked: b.width === 33, onClick: () => setImg({ width: 33 }) }
          ]);
        }
        if (act === 'style') {
          UI.menu(e.target.closest('button'), [
            { header: '圆角' },
            { label: '无圆角', checked: !b.radius, onClick: () => setImg({ radius: 0 }) },
            { label: '小圆角 6px', checked: b.radius === 6, onClick: () => setImg({ radius: 6 }) },
            { label: '大圆角 14px', checked: b.radius === 14, onClick: () => setImg({ radius: 14 }) },
            { sep: true },
            { label: '边框', checked: Boolean(b.border), onClick: () => setImg({ border: !b.border }) },
            { label: '阴影', checked: Boolean(b.shadow), onClick: () => setImg({ shadow: !b.shadow }) },
            { label: '纸色背景衬底', checked: Boolean(b.bg), onClick: () => setImg({ bg: b.bg ? '' : 'var(--paper-inset, #f1eee7)' }) }
          ]);
        }
        if (act === 'edit') openImageEditor(b);
        if (act === 'meta') openImageMeta(b);
        if (act === 'replace') {
          UI.menu(e.target.closest('button'), [
            { label: '上传新图片', icon: 'upload', onClick: async () => { const ids = await pickAndAddImages(); if (ids[0]) setImg({ src: ids[0] }); } },
            { label: '从素材库选择', icon: 'image', onClick: () => libraryPicker((ids) => setImg({ src: ids[0] })) },
            { sep: true },
            { label: '移除图片', danger: true, onClick: () => setImg({ src: '' }) }
          ]);
        }
      });
      const setImg = (patch) => { Object.assign(b, patch); replaceBlockEl(b); changed({ structural: true }); };
      box.appendChild(bar);
      body.appendChild(box);
    }

    function openImageMeta(b) {
      const body = UI.el(`<div class="form-col">
        <label class="form-label">替代文本 Alt</label><input class="input" data-f="alt" value="${UI.esc(b.alt || '')}">
        <label class="form-label">来源</label><input class="input" data-f="source" value="${UI.esc(b.source || '')}" placeholder="例如:作者自摄 / Unsplash">
        <div class="form-row">
          <div style="flex:1"><label class="form-label">拍摄时间</label><input class="input" data-f="date" value="${UI.esc(b.date || '')}" placeholder="2026-07"></div>
          <div style="flex:1"><label class="form-label">拍摄地点</label><input class="input" data-f="place" value="${UI.esc(b.place || '')}" placeholder="纽约"></div>
        </div>
      </div>`);
      UI.modal({
        title: '图片信息', body, width: 440,
        footer: [{ label: '取消' }, {
          label: '保存', kind: 'btn-primary',
          onClick: () => {
            body.querySelectorAll('[data-f]').forEach((input) => { b[input.dataset.f] = input.value.trim(); });
            replaceBlockEl(b);
            changed({ structural: true });
          }
        }]
      });
    }

    // crop / rotate editor
    async function openImageEditor(b) {
      const url = Store.imageUrl(b.src);
      if (!url) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }).catch(() => null);
      if (!img.naturalWidth) { UI.toast('无法编辑此图片', 'error'); return; }

      let rotation = 0;
      let ratio = 0; // 0 = free
      let crop = { x: 0, y: 0, w: 1, h: 1 }; // fractions

      const body = UI.el(`<div class="img-editor">
        <div class="img-editor-stage"><canvas></canvas><div class="crop-box"><div class="crop-handle"></div></div></div>
        <div class="img-editor-tools">
          <button data-e="rotate">${UI.icon('rotate', 15)} 旋转 90°</button>
          <select data-e="ratio" class="input input-sm">
            <option value="0">自由比例</option><option value="1">1:1</option>
            <option value="1.5">3:2</option><option value="1.7778">16:9</option>
            <option value="0.75">3:4</option>
          </select>
          <button data-e="reset">重置</button>
        </div>
      </div>`);
      const canvas = body.querySelector('canvas');
      const cropBox = body.querySelector('.crop-box');
      const stage = body.querySelector('.img-editor-stage');

      function draw() {
        const rotated = rotation % 180 !== 0;
        const sw = rotated ? img.naturalHeight : img.naturalWidth;
        const sh = rotated ? img.naturalWidth : img.naturalHeight;
        const maxW = 560, maxH = 380;
        const scale = Math.min(maxW / sw, maxH / sh, 1);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        const dw = rotated ? canvas.height : canvas.width;
        const dh = rotated ? canvas.width : canvas.height;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
        syncCropBox();
      }

      function syncCropBox() {
        cropBox.style.left = `${canvas.offsetLeft + crop.x * canvas.width}px`;
        cropBox.style.top = `${canvas.offsetTop + crop.y * canvas.height}px`;
        cropBox.style.width = `${crop.w * canvas.width}px`;
        cropBox.style.height = `${crop.h * canvas.height}px`;
      }

      // drag to move crop, handle to resize
      let dragMode = null, start = null;
      cropBox.addEventListener('pointerdown', (e) => {
        dragMode = e.target.classList.contains('crop-handle') ? 'resize' : 'move';
        start = { x: e.clientX, y: e.clientY, crop: { ...crop } };
        cropBox.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      cropBox.addEventListener('pointermove', (e) => {
        if (!dragMode) return;
        const dx = (e.clientX - start.x) / canvas.width;
        const dy = (e.clientY - start.y) / canvas.height;
        if (dragMode === 'move') {
          crop.x = Math.min(Math.max(0, start.crop.x + dx), 1 - crop.w);
          crop.y = Math.min(Math.max(0, start.crop.y + dy), 1 - crop.h);
        } else {
          crop.w = Math.min(Math.max(0.08, start.crop.w + dx), 1 - crop.x);
          crop.h = ratio > 0 ? Math.min((crop.w * canvas.width) / ratio / canvas.height, 1 - crop.y) : Math.min(Math.max(0.08, start.crop.h + dy), 1 - crop.y);
        }
        syncCropBox();
      });
      cropBox.addEventListener('pointerup', () => { dragMode = null; });

      body.querySelector('[data-e="rotate"]').addEventListener('click', () => { rotation = (rotation + 90) % 360; crop = { x: 0, y: 0, w: 1, h: 1 }; draw(); });
      body.querySelector('[data-e="reset"]').addEventListener('click', () => { rotation = 0; crop = { x: 0, y: 0, w: 1, h: 1 }; draw(); });
      body.querySelector('[data-e="ratio"]').addEventListener('change', (e) => {
        ratio = parseFloat(e.target.value) || 0;
        if (ratio > 0) {
          const targetH = (crop.w * canvas.width) / ratio / canvas.height;
          crop.h = Math.min(targetH, 1 - crop.y);
          crop.w = (crop.h * canvas.height * ratio) / canvas.width;
        }
        syncCropBox();
      });

      UI.modal({
        title: '编辑图片', body, width: 640, cls: 'modal-img-editor',
        footer: [
          { label: '取消' },
          {
            label: '应用', kind: 'btn-primary',
            onClick: () => {
              const rotated = rotation % 180 !== 0;
              const fullW = rotated ? img.naturalHeight : img.naturalWidth;
              const fullH = rotated ? img.naturalWidth : img.naturalHeight;
              const out = document.createElement('canvas');
              out.width = Math.max(1, Math.round(crop.w * fullW));
              out.height = Math.max(1, Math.round(crop.h * fullH));
              const ctx = out.getContext('2d');
              ctx.translate(-crop.x * fullW, -crop.y * fullH);
              ctx.translate(fullW / 2, fullH / 2);
              ctx.rotate((rotation * Math.PI) / 180);
              ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
              out.toBlob(async (blob) => {
                if (!blob) return;
                if (b.src?.startsWith('img:')) {
                  await Store.replaceImage(b.src.slice(4), new File([blob], 'edited.jpg', { type: blob.type }));
                } else {
                  const entry = await Store.addImage(new File([blob], 'edited.jpg', { type: blob.type }));
                  b.src = `img:${entry.id}`;
                }
                replaceBlockEl(b);
                changed({ structural: true });
              }, 'image/jpeg', 0.92);
            }
          }
        ]
      });
      requestAnimationFrame(draw);
    }

    // ---------- gallery ----------

    const GALLERY_LAYOUTS = [
      ['grid2', '双图并排'], ['grid3', '三图并排'], ['grid', '图片网格'],
      ['masonry', '瀑布流'], ['carousel', '轮播'], ['compare', '前后对比'], ['row', '横向图组']
    ];

    function renderGallery(b, body) {
      const box = UI.el(`<div class="eb-gallery gallery-${b.layout || 'grid2'}" contenteditable="false"></div>`);
      (b.items || []).forEach((item, idx) => {
        const url = Store.imageUrl(item.src);
        const fig = UI.el(`<figure class="eb-gallery-item"><img src="${url}" alt="${UI.esc(item.alt || '')}">${b.layout === 'compare' ? `<span class="compare-tag">${idx === 0 ? '之前' : '之后'}</span>` : ''}<figcaption><input placeholder="说明" value="${UI.esc(item.caption || '')}"></figcaption></figure>`);
        fig.querySelector('input').addEventListener('input', (e) => { item.caption = e.target.value; changed(); });
        fig.querySelector('input').addEventListener('keydown', (e) => e.stopPropagation());
        fig.querySelector('img').addEventListener('click', () => {
          UI.menu(fig, [
            { label: '左移', disabled: idx === 0, onClick: () => { b.items.splice(idx - 1, 0, b.items.splice(idx, 1)[0]); replaceBlockEl(b); changed({ structural: true }); } },
            { label: '右移', disabled: idx === b.items.length - 1, onClick: () => { b.items.splice(idx + 1, 0, b.items.splice(idx, 1)[0]); replaceBlockEl(b); changed({ structural: true }); } },
            { sep: true },
            { label: '移除这张图', danger: true, onClick: () => { b.items.splice(idx, 1); replaceBlockEl(b); changed({ structural: true }); } }
          ]);
        });
        box.appendChild(fig);
      });
      const tools = UI.el(`<div class="eb-gallery-tools">
        <button data-g="add">${UI.icon('plus', 13)} 加图</button>
        <button data-g="layout">${UI.icon('template', 13)} ${UI.esc(GALLERY_LAYOUTS.find(([k]) => k === (b.layout || 'grid2'))?.[1] || '布局')}</button>
      </div>`);
      tools.addEventListener('click', async (e) => {
        const act = e.target.closest('button')?.dataset.g;
        if (act === 'add') {
          UI.menu(e.target.closest('button'), [
            { label: '上传图片', icon: 'upload', onClick: async () => { const ids = await pickAndAddImages(); b.items.push(...ids.map((src) => ({ src, caption: '' }))); replaceBlockEl(b); changed({ structural: true }); } },
            { label: '从素材库选择', icon: 'image', onClick: () => libraryPicker((ids) => { b.items.push(...ids.map((src) => ({ src, caption: '' }))); replaceBlockEl(b); changed({ structural: true }); }, { multiple: true }) }
          ]);
        }
        if (act === 'layout') {
          UI.menu(e.target.closest('button'), GALLERY_LAYOUTS.map(([key, label]) => ({
            label, checked: (b.layout || 'grid2') === key,
            onClick: () => { b.layout = key; replaceBlockEl(b); changed({ structural: true }); }
          })));
        }
      });
      body.appendChild(box);
      body.appendChild(tools);
    }

    // ---------- insert & block menus ----------

    function openInsertMenu(anchor, afterId) {
      const addText = (type, extra) => () => {
        const nb = MD.block(type, extra);
        const el = insertBlock(nb, afterId);
        const editable = el.querySelector('[contenteditable]');
        if (editable) setCaret(editable, 0);
      };
      UI.menu(anchor, [
        { header: '基础' },
        { label: '正文段落', icon: 'type', onClick: addText('p') },
        { label: '标题 1', icon: 'heading', onClick: addText('h1') },
        { label: '标题 2', icon: 'heading', onClick: addText('h2') },
        { label: '标题 3', icon: 'heading', onClick: addText('h3') },
        { label: '引用', icon: 'quote', onClick: addText('quote') },
        { label: '提示块', icon: 'callout', onClick: addText('callout', { variant: 'info' }) },
        { label: '折叠内容', icon: 'chevronRight', onClick: addText('toggle', { summary: '详情' }) },
        { sep: true },
        { header: '列表' },
        { label: '无序列表', icon: 'listUl', onClick: addText('ul') },
        { label: '有序列表', icon: 'listUl', onClick: addText('ol') },
        { label: '待办列表', icon: 'check', onClick: addText('todo', { checked: false }) },
        { sep: true },
        { header: '图片与排版' },
        { label: '图片', icon: 'image', onClick: () => { insertBlock(MD.block('image', { src: '', alt: '', caption: '', title: '', layout: 'center', width: 100, radius: 6 }), afterId); } },
        { label: '多图排版', icon: 'template', onClick: () => { insertBlock(MD.block('gallery', { items: [], layout: 'grid2' }), afterId); } },
        { label: '双栏布局', icon: 'columns', onClick: () => { insertBlock(MD.block('columns', { cols: [{ text: '' }, { text: '' }] }), afterId); } },
        { sep: true },
        { header: '其他' },
        { label: '分割线', icon: 'divider', onClick: () => insertBlock(MD.block('divider'), afterId) },
        { label: '表格', icon: 'template', onClick: () => insertBlock(MD.block('table', { rows: [['', ''], ['', '']], header: true }), afterId) },
        { label: '代码块', icon: 'code', onClick: () => insertBlock(MD.block('code', { code: '', lang: '' }), afterId) },
        { label: '数学公式', icon: 'sparkle', onClick: () => insertBlock(MD.block('math', { tex: '' }), afterId) }
      ], { minWidth: 200 });
    }

    function openBlockMenu(anchor, id) {
      const b = getBlock(id);
      if (!b) return;
      const idx = blockIndex(id);
      const turn = (type, extra) => () => convertBlock(id, type, extra);
      const items = [
        { header: `${TYPE_LABELS[b.type] || b.type}` }
      ];
      if (TEXT_TYPES.has(b.type)) {
        items.push(
          { label: '转为正文', disabled: b.type === 'p', onClick: turn('p') },
          { label: '转为标题 1', disabled: b.type === 'h1', onClick: turn('h1') },
          { label: '转为标题 2', disabled: b.type === 'h2', onClick: turn('h2') },
          { label: '转为标题 3', disabled: b.type === 'h3', onClick: turn('h3') },
          { label: '转为引用', disabled: b.type === 'quote', onClick: turn('quote') },
          { label: '转为列表', disabled: b.type === 'ul', onClick: turn('ul') },
          { label: '转为待办', disabled: b.type === 'todo', onClick: turn('todo', { checked: false }) },
          { label: '转为提示块', disabled: b.type === 'callout', onClick: turn('callout', { variant: 'info' }) },
          { sep: true },
          { label: '左对齐', checked: !b.align || b.align === 'left', onClick: () => { b.align = 'left'; replaceBlockEl(b); changed({ structural: true }); } },
          { label: '居中', checked: b.align === 'center', onClick: () => { b.align = 'center'; replaceBlockEl(b); changed({ structural: true }); } },
          { label: '右对齐', checked: b.align === 'right', onClick: () => { b.align = 'right'; replaceBlockEl(b); changed({ structural: true }); } },
          { sep: true }
        );
      }
      items.push(
        { label: '上移', icon: 'chevronDown', disabled: idx === 0, onClick: () => { const prev = article.blocks[idx - 1]; moveBlock(id, prev.id, true); } },
        { label: '下移', icon: 'chevronDown', disabled: idx === article.blocks.length - 1, onClick: () => { const next = article.blocks[idx + 1]; moveBlock(id, next.id, false); } },
        { label: '复制块', icon: 'copy', onClick: () => {
          const copy = JSON.parse(JSON.stringify(b));
          copy.id = MD.uid();
          insertBlock(copy, id);
        } },
        { sep: true },
        { label: '删除块', icon: 'trash', danger: true, onClick: () => removeBlock(id) }
      );
      UI.menu(anchor, items, { minWidth: 170 });
    }

    // ---------- drag & drop reorder + image drops ----------

    els.blocks.addEventListener('dragover', (e) => {
      const isBlock = e.dataTransfer.types.includes('text/plume-block');
      const isFile = e.dataTransfer.types.includes('Files');
      if (!isBlock && !isFile) return;
      e.preventDefault();
      const target = e.target.closest('.eb');
      els.blocks.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      if (target) {
        const rect = target.getBoundingClientRect();
        target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
      }
    });
    els.blocks.addEventListener('drop', async (e) => {
      const blockId = e.dataTransfer.getData('text/plume-block');
      const target = e.target.closest('.eb');
      const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!blockId && !files.length) return;
      e.preventDefault();
      const before = target?.classList.contains('drop-before');
      els.blocks.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      if (blockId && target && target.dataset.id !== blockId) {
        moveBlock(blockId, target.dataset.id, before);
      } else if (files.length) {
        let anchor = target ? (before ? article.blocks[blockIndex(target.dataset.id) - 1]?.id || null : target.dataset.id) : article.blocks[article.blocks.length - 1]?.id;
        for (const f of files) {
          const entry = await Store.addImage(f);
          const nb = MD.block('image', { src: `img:${entry.id}`, alt: entry.name.replace(/\.[^.]+$/, ''), caption: '', title: '', layout: 'center', width: 100, radius: 6 });
          insertBlock(nb, anchor);
          anchor = nb.id;
        }
        UI.toast(`已插入 ${files.length} 张图片`);
      }
    });

    // ---------- text editing (delegated) ----------

    els.blocks.addEventListener('input', (e) => {
      const text = e.target.closest?.('.eb-text');
      if (!text) return;
      const wrap = text.closest('.eb');
      const b = getBlock(wrap?.dataset.id);
      if (!b) return;
      if (text.classList.contains('eb-toggle-summary') || text.classList.contains('eb-col')) return; // handled locally
      b.text = MD.sanitizeInline(text.innerHTML);
      if (Store.state.settings.mdInput !== false) tryMarkdownShortcut(b, text);
      updateWikiSuggest(text);
      changed();
    });

    // ----- [[wikilink]] autocomplete -----

    const wikiBox = UI.el('<div class="wiki-suggest" hidden></div>');
    document.body.appendChild(wikiBox);
    let wikiState = null; // { queryLen, active }

    function closeWikiSuggest() {
      wikiBox.hidden = true;
      wikiState = null;
    }

    function updateWikiSuggest(textEl) {
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) { closeWikiSuggest(); return; }
      const range = sel.getRangeAt(0);
      const pre = document.createRange();
      pre.selectNodeContents(textEl);
      pre.setEnd(range.endContainer, range.endOffset);
      const before = pre.toString();
      const m = before.match(/\[\[([^\[\]\n]{0,30})$/);
      if (!m) { closeWikiSuggest(); return; }
      const q = m[1].trim().toLowerCase();
      const options = Store.liveArticles()
        .filter((a) => a.id !== articleId && a.title && (!q || a.title.toLowerCase().includes(q)))
        .slice(0, 8);
      if (!options.length) { closeWikiSuggest(); return; }
      wikiState = { queryLen: m[1].length, active: 0 };
      wikiBox.innerHTML = options.map((a, i) => `<button class="wiki-suggest-item${i === 0 ? ' active' : ''}" data-wiki="${UI.esc(a.title)}">${UI.esc(a.title)}<span>${UI.esc(Store.categoryPath(a.categoryId) || '')}</span></button>`).join('');
      const rect = range.getBoundingClientRect();
      wikiBox.hidden = false;
      wikiBox.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
      wikiBox.style.top = `${rect.bottom + 6}px`;
    }

    function commitWikiSuggest(title) {
      if (!wikiState) return;
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      // "[[query" was just typed, so it lives in the current text node
      try {
        range.setStart(range.startContainer, Math.max(0, range.startOffset - (wikiState.queryLen + 2)));
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, `[[${title}]]`);
      } catch { /* caret crossed nodes — give up quietly */ }
      closeWikiSuggest();
    }

    wikiBox.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const item = e.target.closest('[data-wiki]');
      if (item) commitWikiSuggest(item.dataset.wiki);
    });

    function tryMarkdownShortcut(b, textEl) {
      if (b.type !== 'p') return;
      const plain = textEl.textContent;
      const rules = [
        [/^#\s/, 'h1'], [/^##\s/, 'h2'], [/^###\s/, 'h3'],
        [/^>\s/, 'quote'], [/^[-*]\s(?!\[)/, 'ul'], [/^1[.)]\s/, 'ol'],
        [/^[-*]?\s?\[\s?\]\s/, 'todo']
      ];
      for (const [re, type] of rules) {
        const m = plain.match(re);
        if (m) {
          const rest = plain.slice(m[0].length);
          b.text = UI.esc(rest);
          const el = convertBlock(b.id, type, type === 'todo' ? { checked: false } : {});
          const editable = el?.querySelector('.eb-text');
          if (editable) setCaret(editable, 0);
          return;
        }
      }
      if (/^```/.test(plain)) { convertBlock(b.id, 'code', { code: '', lang: plain.slice(3).trim() }); return; }
      if (/^\$\$\s?$/.test(plain)) { convertBlock(b.id, 'math', { tex: '' }); return; }
      if (/^---\s?$/.test(plain)) {
        b.text = '';
        convertBlock(b.id, 'divider');
        const nb = MD.block('p');
        const el = insertBlock(nb, b.id);
        setCaret(el.querySelector('.eb-text'), 0);
      }
    }

    els.blocks.addEventListener('keydown', (e) => {
      const text = e.target.closest?.('.eb-text');
      if (!text) return;
      const wrap = text.closest('.eb');
      const b = getBlock(wrap?.dataset.id);
      if (!b) return;

      // wiki suggest keyboard navigation takes priority
      if (wikiState && !wikiBox.hidden) {
        const items = [...wikiBox.querySelectorAll('[data-wiki]')];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          wikiState.active = (wikiState.active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === wikiState.active));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          commitWikiSuggest(items[wikiState.active]?.dataset.wiki);
          return;
        }
        if (e.key === 'Escape') { e.stopPropagation(); closeWikiSuggest(); return; }
      }
      const isAux = text.classList.contains('eb-toggle-summary') || text.classList.contains('eb-col') || text.classList.contains('eb-toggle-body') || text.classList.contains('eb-callout-text');

      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        if (isAux) {
          if (text.classList.contains('eb-toggle-summary')) { e.preventDefault(); }
          return; // callout/toggle body: allow newline via shift, block plain enter splitting
        }
        e.preventDefault();
        const [before, after] = splitAtCaret(text);
        // empty list item → back to paragraph
        if (['ul', 'ol', 'todo'].includes(b.type) && !text.textContent.trim()) {
          convertBlock(b.id, 'p');
          return;
        }
        b.text = MD.sanitizeInline(before);
        text.innerHTML = b.text;
        const nextType = ['ul', 'ol', 'todo'].includes(b.type) ? b.type : 'p';
        const nb = MD.block(nextType, nextType === 'todo' ? { checked: false } : {});
        nb.text = MD.sanitizeInline(after);
        const el = insertBlock(nb, b.id);
        setCaret(el.querySelector('.eb-text'), 0);
        return;
      }

      if (e.key === 'Enter' && e.shiftKey && !isAux) {
        e.preventDefault();
        document.execCommand('insertHTML', false, '<br>');
        return;
      }

      if (e.key === 'Backspace' && caretOffset(text) === 0 && !isAux) {
        const idx = blockIndex(b.id);
        if (b.type !== 'p') { e.preventDefault(); convertBlock(b.id, 'p'); return; }
        if (idx > 0) {
          const prev = article.blocks[idx - 1];
          if (TEXT_TYPES.has(prev.type) && prev.type !== 'toggle') {
            e.preventDefault();
            const prevEl = els.blocks.querySelector(`[data-id="${prev.id}"] .eb-text`);
            const mergeAt = MD.plainText(prev.text || '').length;
            prev.text = (prev.text || '') + (b.text || '');
            article.blocks.splice(idx, 1);
            wrap.remove();
            const freshPrev = replaceBlockEl(prev);
            setCaret(freshPrev.querySelector('.eb-text'), mergeAt);
            changed({ structural: true });
          } else if (!text.textContent.trim()) {
            e.preventDefault();
            removeBlock(b.id);
            const prevEl = els.blocks.querySelector(`[data-id="${prev.id}"] [contenteditable]`);
            if (prevEl) setCaret(prevEl, MD.plainText(prev.text || '').length);
          } else if (['divider', 'image', 'gallery'].includes(prev.type)) {
            e.preventDefault();
            removeBlock(prev.id);
          }
        }
        return;
      }

      if ((e.key === 'ArrowUp' && caretOnEdge(text, 'top')) || (e.key === 'ArrowDown' && caretOnEdge(text, 'bottom'))) {
        const idx = blockIndex(b.id);
        const targetIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
        const target = article.blocks[targetIdx];
        if (target) {
          const el = els.blocks.querySelector(`[data-id="${target.id}"] .eb-text, [data-id="${target.id}"] textarea`);
          if (el) {
            e.preventDefault();
            if (el.tagName === 'TEXTAREA') el.focus();
            else setCaret(el, e.key === 'ArrowUp' ? MD.plainText(target.text || '').length : 0);
          }
        }
        return;
      }

      if (e.key === '/' && !text.textContent.trim() && b.type === 'p') {
        e.preventDefault();
        openInsertMenu(wrap.querySelector('.eb-add'), b.id);
      }
    });

    // typewriter mode: keep caret vertically centered
    els.blocks.addEventListener('keyup', () => {
      if (!Store.state.settings.typewriter || !inst.focusMode) return;
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.height) return;
      const targetY = window.innerHeight * 0.45;
      els.scroll.scrollBy({ top: rect.top - targetY, behavior: 'smooth' });
    });

    // paste: sanitize / split / images
    els.blocks.addEventListener('paste', async (e) => {
      const text = e.target.closest?.('.eb-text');
      if (!text) return;
      const wrap = text.closest('.eb');
      const b = getBlock(wrap?.dataset.id);
      if (!b) return;

      const images = [...(e.clipboardData?.items || [])].filter((item) => item.type.startsWith('image/'));
      if (images.length) {
        e.preventDefault();
        let anchor = b.id;
        for (const item of images) {
          const file = item.getAsFile();
          if (!file) continue;
          const entry = await Store.addImage(file);
          const nb = MD.block('image', { src: `img:${entry.id}`, alt: '', caption: '', title: '', layout: 'center', width: 100, radius: 6 });
          insertBlock(nb, anchor);
          anchor = nb.id;
        }
        return;
      }

      const plain = e.clipboardData?.getData('text/plain') || '';
      const html = e.clipboardData?.getData('text/html') || '';
      e.preventDefault();

      // multi-line paste into a paragraph → parse as markdown blocks
      if (plain.includes('\n') && b.type === 'p' && !text.classList.contains('eb-col') && !text.classList.contains('eb-toggle-summary')) {
        const parsed = MD.parse(plain);
        if (parsed.length) {
          let anchor = b.id;
          if (!text.textContent.trim()) {
            // replace current empty paragraph with first parsed block
            const first = parsed.shift();
            Object.keys(b).filter((k) => k !== 'id').forEach((k) => delete b[k]);
            Object.assign(b, first, { id: b.id });
            replaceBlockEl(b);
          }
          for (const nb of parsed) { insertBlock(nb, anchor); anchor = nb.id; }
          changed({ structural: true });
          return;
        }
      }

      const insertHtml = html ? MD.sanitizeInline(html) : UI.esc(plain).replaceAll('\n', '<br>');
      document.execCommand('insertHTML', false, insertHtml);
    });

    // ---------- cross-block selection: paste-replace / delete / cut ----------
    // A selection spanning multiple blocks (e.g. two-stage select-all) lives
    // outside any single contenteditable, so these are document-level handlers.

    function crossBlockSelection() {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return null;
      const r = sel.getRangeAt(0);
      const ca = r.commonAncestorContainer;
      if (!els.blocks.contains(ca)) return null;
      const el = ca.nodeType === 1 ? ca : ca.parentElement;
      if (el !== els.blocks && el?.closest('.eb')) return null; // within a single block → native handling
      const ebs = [...els.blocks.children].filter((c) => c.classList.contains('eb') && r.intersectsNode(c));
      return ebs.length ? { range: r, ebs } : null;
    }

    // replace the selected blocks with blocks parsed from `plain`, keeping any
    // unselected text at the edges of the first / last block; returns the id
    // of the block the caret lands in
    function replaceCrossBlockSelection({ range, ebs }, plain) {
      const edgeHtml = (eb, where) => {
        const textEl = eb.querySelector('.eb-text');
        const node = where === 'before' ? range.startContainer : range.endContainer;
        if (!textEl || !textEl.contains(node)) return '';
        const part = document.createRange();
        part.selectNodeContents(textEl);
        if (where === 'before') part.setEnd(range.startContainer, range.startOffset);
        else part.setStart(range.endContainer, range.endOffset);
        const div = document.createElement('div');
        div.appendChild(part.cloneContents());
        return div.innerHTML;
      };
      const prefix = edgeHtml(ebs[0], 'before');
      const suffix = edgeHtml(ebs[ebs.length - 1], 'after');

      const parsed = plain.trim() ? MD.parse(plain) : [];
      if (prefix) {
        if (parsed[0] && TEXT_TYPES.has(parsed[0].type)) parsed[0].text = MD.sanitizeInline(prefix + (parsed[0].text || ''));
        else { const p = MD.block('p'); p.text = MD.sanitizeInline(prefix); parsed.unshift(p); }
      }
      const suffixLen = MD.plainText(suffix ? MD.sanitizeInline(suffix) : '').length;
      if (suffix) {
        const last = parsed[parsed.length - 1];
        if (last && TEXT_TYPES.has(last.type)) last.text = MD.sanitizeInline((last.text || '') + suffix);
        else { const p = MD.block('p'); p.text = MD.sanitizeInline(suffix); parsed.push(p); }
      }
      if (!parsed.length) parsed.push(MD.block('p'));

      const from = blockIndex(ebs[0].dataset.id);
      const to = blockIndex(ebs[ebs.length - 1].dataset.id);
      article.blocks.splice(from, to - from + 1, ...parsed);
      renderAll();
      changed({ structural: true });
      const lastB = parsed[parsed.length - 1];
      const lastEl = els.blocks.querySelector(`[data-id="${lastB.id}"] .eb-text`);
      if (lastEl) setCaret(lastEl, Math.max(0, MD.plainText(lastB.text || '').length - suffixLen));
      return lastB.id;
    }

    const onDocPaste = async (e) => {
      const cbs = crossBlockSelection();
      if (!cbs) return;
      const plain = e.clipboardData?.getData('text/plain') || '';
      const images = [...(e.clipboardData?.items || [])].filter((item) => item.type.startsWith('image/'));
      if (!plain && !images.length) return; // empty clipboard must not eat the selection
      e.preventDefault();
      e.stopPropagation();
      if (!plain && images.length) {
        const files = images.map((item) => item.getAsFile()).filter(Boolean);
        let anchor = replaceCrossBlockSelection(cbs, '');
        for (const file of files) {
          const entry = await Store.addImage(file);
          const nb = MD.block('image', { src: `img:${entry.id}`, alt: '', caption: '', title: '', layout: 'center', width: 100, radius: 6 });
          insertBlock(nb, anchor);
          anchor = nb.id;
        }
        return;
      }
      replaceCrossBlockSelection(cbs, plain);
    };
    document.addEventListener('paste', onDocPaste, true);

    const onDocDeleteKey = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const cbs = crossBlockSelection();
      if (!cbs) return;
      e.preventDefault();
      e.stopPropagation();
      replaceCrossBlockSelection(cbs, '');
    };
    document.addEventListener('keydown', onDocDeleteKey, true);

    const onDocCut = (e) => {
      const cbs = crossBlockSelection();
      if (!cbs) return;
      e.preventDefault();
      e.stopPropagation();
      e.clipboardData?.setData('text/plain', window.getSelection().toString());
      replaceCrossBlockSelection(cbs, '');
    };
    document.addEventListener('cut', onDocCut, true);

    // ---------- floating format toolbar ----------

    const fmtbar = UI.el(`<div class="fmtbar" hidden>
      <button data-f="bold" title="加粗"><b>B</b></button>
      <button data-f="italic" title="斜体"><i>I</i></button>
      <button data-f="underline" title="下划线"><u>U</u></button>
      <button data-f="strikeThrough" title="删除线"><s>S</s></button>
      <button data-f="mark" title="高亮">${UI.icon('highlighter', 13)}</button>
      <button data-f="code" title="行内代码">${UI.icon('code', 13)}</button>
      <button data-f="link" title="链接">${UI.icon('link', 13)}</button>
    </div>`);
    document.body.appendChild(fmtbar);

    fmtbar.addEventListener('mousedown', (e) => e.preventDefault());
    fmtbar.addEventListener('click', async (e) => {
      const cmd = e.target.closest('button')?.dataset.f;
      if (!cmd) return;
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      if (['bold', 'italic', 'underline', 'strikeThrough'].includes(cmd)) {
        document.execCommand(cmd);
      } else if (cmd === 'mark' || cmd === 'code') {
        const html = (() => { const div = document.createElement('div'); div.appendChild(sel.getRangeAt(0).cloneContents()); return div.innerHTML; })();
        const tag = cmd === 'mark' ? 'mark' : 'code';
        document.execCommand('insertHTML', false, `<${tag}>${html}</${tag}>`);
      } else if (cmd === 'link') {
        const url = await UI.prompt('插入链接', { placeholder: 'https://…' });
        if (url) document.execCommand('createLink', false, url);
      }
      // sync model
      const text = sel.anchorNode?.parentElement?.closest?.('.eb-text');
      if (text) {
        const b = getBlock(text.closest('.eb')?.dataset.id);
        if (b && !text.classList.contains('eb-col') && !text.classList.contains('eb-toggle-summary')) {
          b.text = MD.sanitizeInline(text.innerHTML);
          changed();
        }
      }
    });

    function updateFmtbar() {
      const sel = window.getSelection();
      const within = sel.rangeCount && !sel.isCollapsed && sel.anchorNode && shell.contains(sel.anchorNode) &&
        (sel.anchorNode.parentElement?.closest('.eb-text') || sel.anchorNode.parentElement?.closest('.editor-title'));
      if (!within || sel.anchorNode.parentElement?.closest('.editor-title')) { fmtbar.hidden = true; return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) { fmtbar.hidden = true; return; }
      // hide once the selection has scrolled out of the editor viewport
      const sr = els.scroll.getBoundingClientRect();
      if (rect.bottom < sr.top || rect.top > sr.bottom) { fmtbar.hidden = true; return; }
      fmtbar.hidden = false;
      const x = Math.min(Math.max(8, rect.left + rect.width / 2 - fmtbar.offsetWidth / 2), window.innerWidth - fmtbar.offsetWidth - 8);
      fmtbar.style.left = `${x}px`;
      fmtbar.style.top = `${Math.max(8, rect.top - fmtbar.offsetHeight - 8)}px`;
    }
    const onSelChange = UI.debounce(updateFmtbar, 120);
    document.addEventListener('selectionchange', onSelChange);
    // dismiss the toolbar as soon as a new interaction starts elsewhere, and
    // keep it pinned to the selection while scrolling
    const onDocPointerDown = (e) => {
      lastSelectAllBlock = ''; // clicking breaks the two-stage select-all sequence
      if (!fmtbar.hidden && !fmtbar.contains(e.target)) fmtbar.hidden = true;
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    els.scroll.addEventListener('scroll', () => { if (!fmtbar.hidden) updateFmtbar(); }, { passive: true });

    // ---------- title / meta events ----------

    els.title.addEventListener('input', () => {
      article.title = els.title.textContent.trim();
      changed();
    });
    els.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = els.blocks.querySelector('.eb-text');
        if (first) setCaret(first, 0);
      }
    });
    els.title.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\n+/g, ' '));
    });

    els.cover.querySelector('.cover-remove').addEventListener('click', () => {
      article.cover = '';
      renderCover();
      changed();
    });

    els.metaline.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-meta]');
      if (!chip) return;
      const kind = chip.dataset.meta;
      if (kind === 'category') openCategoryMenu(chip);
      if (kind === 'status') openStatusMenu(chip);
      if (kind === 'tags') openPanel('tags');
    });

    function openCategoryMenu(anchor) {
      const items = [{ label: '未分类', checked: !article.categoryId, onClick: () => setMeta({ categoryId: '' }) }, { sep: true }];
      const walk = (parentId, depth) => {
        for (const cat of Store.childCategories(parentId)) {
          items.push({
            label: `${'    '.repeat(depth)}${cat.name}`,
            checked: article.categoryId === cat.id,
            onClick: () => setMeta({ categoryId: cat.id })
          });
          walk(cat.id, depth + 1);
        }
      };
      walk('', 0);
      items.push({ sep: true }, { label: '＋ 新建分类…', onClick: async () => {
        const name = await UI.prompt('新建分类', { placeholder: '分类名称' });
        if (name) {
          await Store.saveCategory({ name });
          const cat = Store.state.categories.find((c) => c.name === name);
          if (cat) setMeta({ categoryId: cat.id });
        }
      } });
      UI.menu(anchor, items, { minWidth: 200 });
    }

    function openStatusMenu(anchor) {
      UI.menu(anchor, Store.allStatuses().map((s) => ({
        label: s.name, checked: article.status === s.id,
        onClick: () => setMeta({ status: s.id })
      })));
    }

    async function setMeta(patch) {
      await Store.updateArticle(articleId, patch, { touch: false });
      renderMetaline();
      renderCrumb();
      if (inst.panelOpen) renderPanel();
    }

    // ---------- info panel ----------

    function openPanel(focusSection = '') {
      inst.panelOpen = true;
      els.panel.hidden = false;
      renderPanel();
      if (focusSection === 'tags') els.panel.querySelector('.tag-editor-input')?.focus();
    }

    function closePanel() {
      inst.panelOpen = false;
      els.panel.hidden = true;
    }

    function renderPanel() {
      const themes = Reader.THEMES;
      const collections = Store.state.collections;
      const inCollections = Store.collectionsOf(articleId).map((c) => c.id);
      els.panel.innerHTML = `
        <div class="panel-head"><h3>文章信息</h3><button class="icon-btn" data-p="close">${UI.icon('x', 15)}</button></div>
        <div class="panel-scroll">
          <section><label class="form-label">摘要</label>
            <textarea class="input panel-digest" rows="3" placeholder="一句话介绍这篇文章…">${UI.esc(article.digest || '')}</textarea>
          </section>
          <section><label class="form-label">封面</label>
            <div class="panel-cover">${article.cover ? `<img src="${Store.imageUrl(article.cover)}" alt="">` : '<span class="panel-cover-empty">未设置封面</span>'}</div>
            <div class="form-row">
              <button class="btn btn-sm" data-p="cover-upload">上传</button>
              <button class="btn btn-sm" data-p="cover-library">素材库</button>
              ${article.cover ? '<button class="btn btn-sm" data-p="cover-remove">移除</button>' : ''}
            </div>
          </section>
          <section><label class="form-label">状态</label><div class="panel-status-row"></div></section>
          <section><label class="form-label">主分类</label><button class="btn btn-sm btn-block" data-p="category">${UI.esc(article.categoryId ? Store.categoryPath(article.categoryId) : '选择分类')}</button>
            <label class="form-label">辅助分类</label><div class="panel-extra-cats"></div>
          </section>
          <section><label class="form-label">标签</label><div class="panel-tags"></div></section>
          <section><label class="form-label">合集</label>
            <div class="panel-collections">${collections.length ? collections.map((c) => `
              <label class="check-row"><input type="checkbox" data-col="${c.id}" ${inCollections.includes(c.id) ? 'checked' : ''}> ${UI.esc(c.name)}</label>`).join('') : '<span class="hint">还没有合集,可在侧边栏创建</span>'}
            </div>
          </section>
          <section><label class="form-label">关联</label><div class="panel-links"></div></section>
          <section><label class="form-label">阅读主题</label>
            <select class="input input-sm" data-p="theme">
              <option value="">默认(${UI.esc(themes.find((t) => t.id === Store.state.settings.defaultTheme)?.name || '极简白')})</option>
              ${themes.map((t) => `<option value="${t.id}" ${article.theme === t.id ? 'selected' : ''}>${UI.esc(t.name)}</option>`).join('')}
            </select>
          </section>
          <section class="panel-grid">
            <div><label class="form-label">优先级</label>
              <select class="input input-sm" data-p="priority">
                ${['无', '低', '中', '高'].map((p, i) => `<option value="${i}" ${article.priority === i ? 'selected' : ''}>${p}</option>`).join('')}
              </select></div>
            <div><label class="form-label">截止日期</label><input class="input input-sm" type="date" data-p="due" value="${UI.esc(article.dueDate || '')}"></div>
            <div><label class="form-label">目标字数</label><input class="input input-sm" type="number" min="0" step="100" data-p="target" value="${article.targetWords || ''}" placeholder="0"></div>
          </section>
          <section class="panel-switches">
            <label class="check-row"><input type="checkbox" data-p="pinned" ${article.pinned ? 'checked' : ''}> 置顶</label>
            <label class="check-row"><input type="checkbox" data-p="favorite" ${article.favorite ? 'checked' : ''}> 收藏</label>
          </section>
          <section class="panel-times hint">
            创建于 ${UI.fmtDateTime(article.createdAt)}<br>最后编辑 ${UI.fmtDateTime(article.updatedAt)}
          </section>
        </div>`;

      els.panel.querySelector('.panel-links').appendChild(buildLinksSection());
      els.panel.querySelector('.panel-status-row').appendChild(buildStatusRow());
      els.panel.querySelector('.panel-tags').appendChild(UI.tagEditor(article.tags || [], (tags) => setMeta({ tags })));
      const extraWrap = els.panel.querySelector('.panel-extra-cats');
      extraWrap.appendChild(buildExtraCats());

      els.panel.querySelector('.panel-digest').addEventListener('input', UI.debounce((e) => {
        article.digest = e.target.value;
        changed();
      }, 400));

      els.panel.addEventListener('change', onPanelChange);
      els.panel.addEventListener('click', onPanelClick);
    }

    function buildLinksSection() {
      const wrap = UI.el('<div class="panel-links-inner"></div>');
      const links = Store.linksOf(articleId);
      const refs = Store.wikiRefs(articleId);
      const backs = Store.backlinksOf(articleId);
      const paths = Store.pathsOf(articleId);
      const suggestions = Store.suggestRelated(articleId, 4);

      const row = (label, node) => {
        const r = UI.el(`<div class="plink-group"><span class="plink-label">${UI.esc(label)}</span></div>`);
        r.appendChild(node);
        wrap.appendChild(r);
      };
      const articleLink = (a, extra = '') => UI.el(`<a class="plink-item" href="#/edit/${a.id}">${UI.esc(a.title || '未命名')}${extra}</a>`);

      if (links.length) {
        const box = UI.el('<div class="plink-list"></div>');
        for (const l of links) {
          const otherId = l.fromId === articleId ? l.toId : l.fromId;
          const other = Store.article(otherId);
          if (!other) continue;
          const typeName = Store.LINK_TYPES.find((t) => t.id === l.type)?.name || l.type;
          const dir = l.directed ? (l.fromId === articleId ? '→' : '←') : '·';
          const item = UI.el(`<div class="plink-row"><span class="plink-type">${UI.esc(typeName)} ${dir}</span><a href="#/edit/${other.id}">${UI.esc(other.title || '未命名')}</a><button class="icon-btn" title="删除关联">${UI.icon('x', 12)}</button></div>`);
          item.querySelector('button').addEventListener('click', async () => { await Store.deleteLink(l.id); renderPanel(); });
          box.appendChild(item);
        }
        row('已建立的关系', box);
      }
      if (refs.length) {
        const box = UI.el('<div class="plink-list"></div>');
        refs.forEach((a) => box.appendChild(articleLink(a)));
        row('本文引用', box);
      }
      if (backs.length) {
        const box = UI.el('<div class="plink-list"></div>');
        backs.forEach((a) => box.appendChild(articleLink(a)));
        row('反向链接', box);
      }
      if (paths.length) {
        const box = UI.el('<div class="plink-list"></div>');
        paths.forEach((p) => box.appendChild(UI.el(`<a class="plink-item" href="#/graph">${UI.esc(p.name)}(${p.items.length} 篇)</a>`)));
        row('所属思维路径', box);
      }
      if (suggestions.length) {
        const box = UI.el('<div class="plink-list"></div>');
        for (const s of suggestions) {
          const item = UI.el(`<div class="plink-row plink-suggest"><a href="#/edit/${s.article.id}" title="${UI.esc(s.reason)}">${UI.esc(s.article.title || '未命名')}</a><button class="btn btn-xs" title="${UI.esc(s.reason)}">建立关联</button></div>`);
          item.querySelector('button').addEventListener('click', (e) => {
            UI.menu(e.target, Store.LINK_TYPES.map((t) => ({
              label: t.name,
              onClick: async () => { await Store.addLink(articleId, s.article.id, t.id); renderPanel(); }
            })));
          });
          box.appendChild(item);
        }
        row('相关推荐(基于标签 / 分类 / 关键词)', box);
      }

      const add = UI.el(`<button class="meta-chip meta-add">${UI.icon('plus', 12)} 添加关联</button>`);
      add.addEventListener('click', () => {
        const candidates = Store.liveArticles().filter((a) => a.id !== articleId).slice(0, 30);
        UI.menu(add, candidates.map((a) => ({
          label: a.title || '未命名',
          onClick: () => {
            UI.menu(add, Store.LINK_TYPES.map((t) => ({
              label: t.name,
              onClick: async () => { await Store.addLink(articleId, a.id, t.id); renderPanel(); }
            })));
          }
        })).concat(candidates.length ? [] : [{ label: '没有其他文章', disabled: true }]), { minWidth: 220 });
      });
      wrap.appendChild(add);
      const hint = UI.el('<div class="hint" style="margin-top:6px">在正文中输入 [[ 可以引用其他文章,在思维星图中可视化全部关系。</div>');
      wrap.appendChild(hint);
      return wrap;
    }

    function buildStatusRow() {
      const row = UI.el('<div class="status-row-picker"></div>');
      for (const s of Store.allStatuses()) {
        const btn = UI.el(`<button class="status-opt c-${s.color}${article.status === s.id ? ' active' : ''}">${UI.esc(s.name)}</button>`);
        btn.addEventListener('click', () => setMeta({ status: s.id }));
        row.appendChild(btn);
      }
      return row;
    }

    function buildExtraCats() {
      const wrap = UI.el('<div class="extra-cats"></div>');
      for (const cid of article.extraCategoryIds || []) {
        const chip = UI.el(`<span class="tag-chip c-gray">${UI.esc(Store.categoryPath(cid) || '?')}<button class="tag-remove">×</button></span>`);
        chip.querySelector('button').addEventListener('click', () => setMeta({ extraCategoryIds: article.extraCategoryIds.filter((x) => x !== cid) }));
        wrap.appendChild(chip);
      }
      const add = UI.el(`<button class="meta-chip meta-add">${UI.icon('plus', 12)} 添加</button>`);
      add.addEventListener('click', () => {
        const items = [];
        const walk = (parentId, depth) => {
          for (const cat of Store.childCategories(parentId)) {
            if (cat.id !== article.categoryId && !(article.extraCategoryIds || []).includes(cat.id)) {
              items.push({ label: `${'    '.repeat(depth)}${cat.name}`, onClick: () => setMeta({ extraCategoryIds: [...(article.extraCategoryIds || []), cat.id] }) });
            }
            walk(cat.id, depth + 1);
          }
        };
        walk('', 0);
        UI.menu(add, items.length ? items : [{ label: '没有其他分类', disabled: true }]);
      });
      wrap.appendChild(add);
      return wrap;
    }

    function onPanelChange(e) {
      const p = e.target.dataset.p;
      if (p === 'theme') setMeta({ theme: e.target.value });
      if (p === 'priority') setMeta({ priority: Number(e.target.value) });
      if (p === 'due') setMeta({ dueDate: e.target.value });
      if (p === 'target') { setMeta({ targetWords: Number(e.target.value) || 0 }); renderFootStats(); }
      if (p === 'pinned') setMeta({ pinned: e.target.checked });
      if (p === 'favorite') setMeta({ favorite: e.target.checked });
      const col = e.target.dataset.col;
      if (col) {
        e.target.checked ? Store.addToCollection(col, articleId) : Store.removeFromCollection(col, articleId);
      }
    }

    async function onPanelClick(e) {
      const p = e.target.closest('[data-p]')?.dataset.p;
      if (p === 'close') closePanel();
      if (p === 'category') openCategoryMenu(e.target.closest('[data-p]'));
      if (p === 'cover-upload') {
        const files = await UI.pickFiles('image/*');
        if (files[0]) {
          const entry = await Store.addImage(files[0]);
          await setMeta({ cover: `img:${entry.id}` });
          article.cover = `img:${entry.id}`;
          renderCover(); renderPanel();
        }
      }
      if (p === 'cover-library') libraryPicker(async (ids) => {
        await setMeta({ cover: ids[0] });
        article.cover = ids[0];
        renderCover(); renderPanel();
      });
      if (p === 'cover-remove') { await setMeta({ cover: '' }); article.cover = ''; renderCover(); renderPanel(); }
    }

    // ---------- version history ----------

    async function openHistory() {
      const versions = await Store.versionsOf(articleId);
      const body = UI.el('<div class="history-list"></div>');
      if (!versions.length) body.innerHTML = '<div class="empty-state small">还没有历史版本。写作过程中会自动保存版本快照。</div>';
      for (const v of versions) {
        const row = UI.el(`<div class="history-row">
          <div class="history-info">
            <b>${UI.esc(v.name || '自动保存')}</b>
            <span class="hint">${UI.fmtDateTime(v.createdAt)} · ${v.wordCount} 字</span>
          </div>
          <div class="history-acts">
            <button class="btn btn-sm" data-h="diff">对比</button>
            <button class="btn btn-sm" data-h="name">命名</button>
            <button class="btn btn-sm btn-primary" data-h="restore">恢复</button>
          </div>
        </div>`);
        row.addEventListener('click', async (e) => {
          const act = e.target.closest('button')?.dataset.h;
          if (act === 'restore') {
            if (await UI.confirm('恢复版本', `将文章恢复到 ${UI.fmtDateTime(v.createdAt)} 的版本?当前内容会先自动备份。`)) {
              await Store.restoreVersion(articleId, v.id);
              m.close();
              renderAll();
              UI.toast('已恢复历史版本', 'success');
            }
          }
          if (act === 'name') {
            const name = await UI.prompt('版本名称', { value: v.name || '', placeholder: '例如:初稿完成' });
            if (name != null) { v.name = name; await PlumeDB.put('versions', v); row.querySelector('b').textContent = name || '自动保存'; }
          }
          if (act === 'diff') showDiff(v);
        });
        body.appendChild(row);
      }
      const m = UI.modal({
        title: '版本历史', body, width: 560,
        footer: [{ label: '保存当前为新版本', kind: 'btn-primary', close: false, onClick: async () => {
          const name = await UI.prompt('版本名称', { placeholder: '例如:第二稿' });
          if (name != null) { await Store.snapshot(articleId, name || ''); m.close(); openHistory(); }
          return false;
        } }]
      });
    }

    function showDiff(v) {
      const oldLines = MD.blocksToMarkdown(v.blocks).split('\n');
      const newLines = MD.blocksToMarkdown(article.blocks).split('\n');
      // simple LCS-based line diff
      const n = oldLines.length, m2 = newLines.length;
      const dp = Array.from({ length: n + 1 }, () => new Array(m2 + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m2 - 1; j >= 0; j--) {
          dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      const out = [];
      let i = 0, j = 0;
      while (i < n && j < m2) {
        if (oldLines[i] === newLines[j]) { out.push(['same', oldLines[i]]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['del', oldLines[i++]]);
        else out.push(['add', newLines[j++]]);
      }
      while (i < n) out.push(['del', oldLines[i++]]);
      while (j < m2) out.push(['add', newLines[j++]]);

      const html = out.map(([kind, line]) =>
        `<div class="diff-line diff-${kind}">${kind === 'add' ? '+' : kind === 'del' ? '−' : ' '} ${UI.esc(line) || '&nbsp;'}</div>`).join('');
      UI.modal({
        title: `与 ${UI.fmtDateTime(v.createdAt)} 版本对比`,
        body: `<div class="diff-view">${html}</div>`,
        width: 680
      });
    }

    // ---------- focus mode ----------

    function toggleFocus(force) {
      inst.focusMode = force != null ? force : !inst.focusMode;
      document.body.classList.toggle('focus-mode', inst.focusMode);
      shell.classList.toggle('focus', inst.focusMode);
      if (inst.focusMode) {
        closePanel();
        UI.toast('专注模式 · 按 Esc 退出');
      }
    }

    // auto-hide topbar in focus mode
    let idleTimer = null;
    const onMouseMove = () => {
      if (!inst.focusMode) return;
      shell.classList.remove('chrome-hidden');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (inst.focusMode) shell.classList.add('chrome-hidden'); }, 2200);
    };
    shell.addEventListener('mousemove', onMouseMove);

    // ---------- topbar actions ----------

    shell.querySelector('.editor-topbar').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'back') { opts.onBack ? opts.onBack() : history.back(); }
      if (act === 'history') openHistory();
      if (act === 'read') { location.hash = `#/read/${articleId}`; }
      if (act === 'focus') toggleFocus();
      if (act === 'panel') inst.panelOpen ? closePanel() : openPanel();
      if (act === 'more') {
        UI.menu(e.target.closest('[data-act]'), [
          { label: '导出…', icon: 'download', onClick: () => Exporter.exportDialog(articleId) },
          { label: '复制排版结果(富文本)', icon: 'copy', onClick: () => Exporter.copyRich(articleId) },
          { sep: true },
          { label: '保存版本快照', icon: 'history', onClick: async () => { await Store.snapshot(articleId, '手动保存'); UI.toast('已保存版本', 'success'); } },
          { label: '存为模板', icon: 'template', onClick: async () => { await Store.articleToTemplate(articleId); UI.toast('已保存为模板', 'success'); } },
          { label: '创建副本', icon: 'copy', onClick: async () => { const copy = await Store.duplicateArticle(articleId); location.hash = `#/edit/${copy.id}`; } },
          { sep: true },
          { label: '移到回收站', icon: 'trash', danger: true, onClick: async () => {
            if (await UI.confirm('移到回收站', '文章会保留在回收站 30 天,期间可以随时恢复。', { danger: true, okText: '移入回收站' })) {
              await Store.trashArticle(articleId);
              location.hash = Store.state.lastListRoute || '#/articles';
            }
          } }
        ], { align: 'right' });
      }
    });

    // keyboard shortcuts
    let lastSelectAllBlock = ''; // block id whose contents the previous Cmd/Ctrl+A selected
    const onKeydown = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      const isSelectAll = meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a';
      // any non-modifier key other than the select-all chord breaks the two-stage sequence
      if (!isSelectAll && !['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) lastSelectAllBlock = '';
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); persist(); setSaveState('saving'); }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocus(); }
      // Cmd/Ctrl+A is two-stage in the body: first press selects the current
      // block (native), a second press escalates to the whole body across blocks.
      if (isSelectAll) {
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
        const sel = window.getSelection();
        const anchor = sel.anchorNode;
        const inTitle = els.title.contains(anchor) || document.activeElement === els.title;
        const inBody = (ae?.closest?.('.eb-text') && els.blocks.contains(ae)) || (anchor && els.blocks.contains(anchor));
        if (!inBody || inTitle) return; // native behaviour in title / inputs
        const selectAllBody = () => {
          e.preventDefault();
          lastSelectAllBlock = '';
          // an anchor inside a contenteditable pins the selection to that block
          // in Chrome/WebKit — blur it first so the range may span all blocks
          if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
          const range = document.createRange();
          range.selectNodeContents(els.blocks);
          sel.removeAllRanges();
          sel.addRange(range);
        };
        const node = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentNode);
        const textEl = node?.closest?.('.eb-text');
        if (!textEl) { selectAllBody(); return; } // already spanning blocks → keep whole body
        const blockId = textEl.closest('.eb')?.dataset.id || '';
        // escalate when: second consecutive press on the same block, the block's
        // text is already fully selected, or the block is empty
        const norm = (s) => s.replace(/\s+/g, '');
        const blockFull = !sel.isCollapsed && norm(sel.toString()) !== '' && norm(sel.toString()) === norm(textEl.textContent);
        if ((blockId && lastSelectAllBlock === blockId) || blockFull || !textEl.textContent.trim()) {
          selectAllBody();
          return;
        }
        // first press: let the native Cmd/Ctrl+A select just this block
        lastSelectAllBlock = blockId;
        return;
      }
      if (e.key === 'Escape' && !fmtbar.hidden) { fmtbar.hidden = true; return; }
      if (e.key === 'Escape' && inst.focusMode) toggleFocus(false);
    };
    shell.addEventListener('keydown', onKeydown);

    // clicking empty tail area appends a paragraph
    els.tail.addEventListener('click', () => {
      const last = article.blocks[article.blocks.length - 1];
      if (last && last.type === 'p' && !MD.plainText(last.text || '').trim()) {
        setCaret(els.blocks.querySelector(`[data-id="${last.id}"] .eb-text`), 0);
      } else {
        const nb = MD.block('p');
        const el = insertBlock(nb, last?.id);
        setCaret(el.querySelector('.eb-text'), 0);
      }
    });

    // ---------- boot ----------

    renderAll();
    pushUndo();
    setSaveState('saved');
    if (!article.title && MD.textOf(article.blocks).trim() === '') {
      setTimeout(() => els.title.focus(), 60);
    }

    inst.destroy = () => {
      inst.destroyed = true;
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('paste', onDocPaste, true);
      document.removeEventListener('keydown', onDocDeleteKey, true);
      document.removeEventListener('cut', onDocCut, true);
      fmtbar.remove();
      wikiBox.remove();
      document.body.classList.remove('focus-mode');
      clearTimeout(idleTimer);
      // final flush
      Store.updateArticle(articleId, { title: article.title, digest: article.digest, blocks: article.blocks, cover: article.cover })
        .then(() => localStorage.removeItem(CACHE_KEY))
        .catch(() => {});
    };
    return inst;
  }

  return { open };
})();
