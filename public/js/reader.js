/* Reading mode + article theme registry. Global: Reader */
const Reader = (() => {
  const THEMES = [
    { id: 'minimal', name: '极简白', desc: '干净留白,内容优先' },
    { id: 'magazine', name: '现代杂志', desc: '大标题与强对比排版' },
    { id: 'academic', name: '学术论文', desc: '衬线正文,严谨编号感' },
    { id: 'essay', name: '文艺随笔', desc: '衬线字体,宽松行距' },
    { id: 'photo', name: '摄影图文', desc: '大图优先,弱化文字装饰' },
    { id: 'news', name: '新闻报道', desc: '紧凑正文,清晰层级' },
    { id: 'dark', name: '深色阅读', desc: '夜间友好的深色纸面' },
    { id: 'book', name: '中文书刊', desc: '书刊式版心与首行缩进' },
    { id: 'blog', name: '个人博客', desc: '轻松、亲切的网络排版' }
  ];

  const themeOf = (article) => article.theme || Store.state.settings.defaultTheme || 'minimal';

  function articleHtml(article, { headingIds = true, includeMeta = true } = {}) {
    const coverUrl = Store.imageUrl(article.cover);
    const cat = Store.category(article.categoryId);
    const author = Store.state.settings.author;
    const metaBits = [
      author ? UI.esc(author) : '',
      UI.fmtDate(article.updatedAt),
      `约 ${article.readMinutes || 1} 分钟`
    ].filter(Boolean).join(' · ');
    return `
      ${coverUrl ? `<div class="reader-cover"><img src="${UI.esc(coverUrl)}" alt=""></div>` : ''}
      <header class="reader-head">
        <h1 class="reader-title">${UI.esc(article.title || '未命名')}</h1>
        ${article.digest ? `<p class="reader-digest">${UI.esc(article.digest)}</p>` : ''}
        ${includeMeta ? `<div class="reader-meta">${metaBits}${cat ? ` · ${UI.esc(Store.categoryPath(cat.id))}` : ''}</div>` : ''}
      </header>
      <div class="reader-body">${MD.blocksToHtml(article.blocks || [], {
        resolveSrc: Store.imageUrl,
        headingIds,
        resolveWiki: (title) => {
          const target = Store.liveArticles().find((a) => (a.title || '').trim() === title);
          return target ? `#/read/${target.id}` : null;
        }
      })}</div>`;
  }

  function render(container, articleId) {
    const article = Store.article(articleId);
    if (!article) { container.innerHTML = '<div class="empty-state">文章不存在</div>'; return { destroy() {} }; }

    // prev / next within the last list context
    const siblings = Store.filterArticles(Store.state.lastListFilter || {});
    const idx = siblings.findIndex((a) => a.id === articleId);
    const prev = idx > 0 ? siblings[idx - 1] : null;
    const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

    const toc = MD.outline(article.blocks || []);
    const tags = article.tags || [];
    const collections = Store.collectionsOf(articleId);
    const backlinks = Store.backlinksOf(articleId);

    container.innerHTML = '';
    const shell = UI.el(`<div class="reader-shell rt-${themeOf(article)}">
      <div class="reader-topbar">
        <div class="etb-left">
          <button class="icon-btn" data-r="back" title="返回">${UI.icon('back')}</button>
          <span class="etb-crumb">${UI.esc(Store.categoryPath(article.categoryId) || '阅读')}</span>
        </div>
        <div class="etb-right">
          <button class="btn btn-sm" data-r="theme">${UI.icon('bookOpen', 14)} ${UI.esc(THEMES.find((t) => t.id === themeOf(article))?.name || '主题')}</button>
          <button class="icon-btn" data-r="edit" title="编辑">${UI.icon('pen')}</button>
          <button class="icon-btn" data-r="copylink" title="复制链接">${UI.icon('link')}</button>
          <button class="icon-btn" data-r="print" title="打印">${UI.icon('print')}</button>
          <button class="icon-btn" data-r="export" title="导出">${UI.icon('download')}</button>
        </div>
      </div>
      <div class="reader-layout">
        ${toc.length >= 2 ? `<nav class="reader-toc"><div class="toc-title">目录</div>${toc.map((h) => `<a href="#" data-anchor="${h.anchor}" class="toc-l${h.level}">${UI.esc(h.text)}</a>`).join('')}</nav>` : ''}
        <div class="reader-scroll">
          <article class="reader-article">${articleHtml(article)}</article>
          <footer class="reader-foot">
            ${tags.length ? `<div class="reader-tags">${tags.map((t) => UI.tagChip(t)).join('')}</div>` : ''}
            ${collections.length ? `<div class="reader-cols hint">收录于:${collections.map((c) => `<a href="#/collection/${c.id}">${UI.esc(c.name)}</a>`).join('、')}</div>` : ''}
            ${backlinks.length ? `<div class="reader-cols hint">反向链接:${backlinks.map((a) => `<a href="#/read/${a.id}">${UI.esc(a.title || '未命名')}</a>`).join('、')}</div>` : ''}
            <div class="reader-nav">
              ${prev ? `<a class="reader-nav-item" href="#/read/${prev.id}"><span class="hint">上一篇</span><b>${UI.esc(prev.title || '未命名')}</b></a>` : '<span></span>'}
              ${next ? `<a class="reader-nav-item next" href="#/read/${next.id}"><span class="hint">下一篇</span><b>${UI.esc(next.title || '未命名')}</b></a>` : '<span></span>'}
            </div>
          </footer>
        </div>
      </div>
    </div>`);
    container.appendChild(shell);

    const scroll = shell.querySelector('.reader-scroll');

    shell.addEventListener('click', (e) => {
      const anchor = e.target.closest('[data-anchor]');
      if (anchor) {
        e.preventDefault();
        shell.querySelector(`#${anchor.dataset.anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const act = e.target.closest('[data-r]')?.dataset.r;
      if (!act) return;
      if (act === 'back') history.back();
      if (act === 'edit') location.hash = `#/edit/${articleId}`;
      if (act === 'print') window.print();
      if (act === 'export') Exporter.exportDialog(articleId);
      if (act === 'copylink') {
        navigator.clipboard?.writeText(location.href)
          .then(() => UI.toast('链接已复制', 'success'))
          .catch(() => UI.toast('复制失败,请从地址栏复制', 'error'));
      }
      if (act === 'theme') {
        UI.menu(e.target.closest('[data-r]'), THEMES.map((t) => ({
          label: t.name, hint: t.desc, checked: themeOf(article) === t.id,
          onClick: async () => {
            await Store.updateArticle(articleId, { theme: t.id }, { touch: false });
            render(container, articleId);
          }
        })), { align: 'right', minWidth: 220 });
      }
    });

    // active TOC highlight
    if (toc.length >= 2) {
      const links = [...shell.querySelectorAll('.reader-toc a')];
      scroll.addEventListener('scroll', UI.debounce(() => {
        let active = links[0];
        for (const link of links) {
          const h = shell.querySelector(`#${link.dataset.anchor}`);
          if (h && h.getBoundingClientRect().top < 140) active = link;
        }
        links.forEach((l) => l.classList.toggle('active', l === active));
      }, 80), { passive: true });
    }

    return { destroy() {} };
  }

  return { THEMES, themeOf, articleHtml, render };
})();
