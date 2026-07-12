/* Application data store. Global: Store
 * Loads everything from IndexedDB into memory, exposes CRUD + queries,
 * emits 'change' after every mutation so views can re-render.
 */
const Store = (() => {
  const state = {
    ready: false,
    articles: [],        // includes trashed (deletedAt set)
    images: [],          // metadata + blob
    categories: [],
    tags: [],
    collections: [],
    templates: [],
    views: [],
    links: [],           // manual article relations
    paths: [],           // thought paths (ordered article sequences)
    settings: {},
    dailyStats: {},      // { 'YYYY-MM-DD': words }
    lastListRoute: '#/articles'
  };

  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // ---------- built-ins ----------

  const STATUSES = [
    { id: 'idea', name: '灵感', color: 'violet' },
    { id: 'draft', name: '草稿', color: 'gray' },
    { id: 'writing', name: '写作中', color: 'blue' },
    { id: 'revising', name: '待修改', color: 'amber' },
    { id: 'done', name: '已完成', color: 'green' },
    { id: 'archived', name: '已归档', color: 'stone' }
  ];

  const DEFAULT_SETTINGS = {
    author: '',
    uiTheme: 'auto',            // light | dark | auto
    defaultTheme: 'minimal',    // article reading theme
    editorFont: 'sans',         // sans | serif
    editorFontSize: 17,
    editorWidth: 720,
    lineHeight: 1.8,
    autosave: true,
    spellcheck: false,
    mdInput: true,
    showMeta: true,
    typewriter: false,
    imgCompress: true,
    imgMaxWidth: 2000,
    imgQuality: 0.85,
    customStatuses: [],
    trashDays: 30,
    aiPlugin: false             // reserved: AI features stay off by default
  };

  const BUILTIN_TEMPLATES = [
    { name: '日记', icon: 'notebook', desc: '记录今天的所见所感', status: 'draft', md: '## 今天\n\n\n\n## 想法\n\n\n\n## 明天\n\n' },
    { name: '读书笔记', icon: 'bookOpen', desc: '书名、金句与思考', status: 'draft', md: '> [!info] 书名 / 作者 / 阅读日期\n\n## 核心观点\n\n\n\n## 印象最深的段落\n\n> \n\n## 我的思考\n\n' },
    { name: '论文笔记', icon: 'file', desc: '结构化拆解一篇论文', status: 'writing', md: '> [!info] 标题 / 作者 / 会议年份 / 链接\n\n## 问题与动机\n\n\n\n## 方法\n\n\n\n## 实验\n\n\n\n## 我的评价\n\n\n\n## 可借鉴之处\n\n' },
    { name: '实验记录', icon: 'flask', desc: '目标、设置、结果与结论', status: 'writing', md: '## 实验目标\n\n\n\n## 设置\n\n- 模型:\n- 数据:\n- 超参数:\n\n## 结果\n\n| 指标 | 数值 |\n| --- | --- |\n|  |  |\n\n## 结论\n\n\n\n## 下一步\n\n- [ ] ' },
    { name: '周报', icon: 'calendar', desc: '本周进展与下周计划', status: 'draft', md: '## 本周完成\n\n- \n\n## 遇到的问题\n\n- \n\n## 下周计划\n\n- [ ] ' },
    { name: '旅行记录', icon: 'compass', desc: '路线、见闻与照片', status: 'draft', md: '## 行程\n\n\n\n## 见闻\n\n\n\n## 照片\n\n\n\n## 小结\n\n' },
    { name: '摄影故事', icon: 'camera', desc: '以图为主的叙事文章', status: 'draft', md: '拍摄地点与时间。\n\n---\n\n\n\n---\n\n后记。' },
    { name: '访谈稿', icon: 'mic', desc: '问答式访谈整理', status: 'writing', md: '> [!note] 受访者 / 时间 / 地点\n\n**问:**\n\n答:\n\n**问:**\n\n答:\n\n## 后记\n\n' },
    { name: '产品需求文档', icon: 'ruler', desc: '背景、目标、方案、验收', status: 'writing', md: '## 背景\n\n\n\n## 目标与非目标\n\n\n\n## 方案\n\n\n\n## 里程碑\n\n- [ ] \n\n## 验收标准\n\n- [ ] ' },
    { name: '长篇文章', icon: 'feather', desc: '引言、论点、案例与结语', status: 'writing', md: '引言:为什么要写这篇文章。\n\n## 一\n\n\n\n## 二\n\n\n\n## 三\n\n\n\n## 结语\n\n' },
    { name: '年度总结', icon: 'chart', desc: '回顾一年,展望来年', status: 'draft', md: '## 关键词\n\n\n\n## 做成的事\n\n\n\n## 遗憾\n\n\n\n## 明年\n\n- [ ] ' }
  ];

  // ---------- helpers ----------

  const now = () => new Date().toISOString();
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  async function saveMeta(id) {
    const map = {
      settings: () => ({ id: 'settings', ...state.settings }),
      categories: () => ({ id: 'categories', items: state.categories }),
      tags: () => ({ id: 'tags', items: state.tags }),
      collections: () => ({ id: 'collections', items: state.collections }),
      templates: () => ({ id: 'templates', items: state.templates }),
      views: () => ({ id: 'views', items: state.views }),
      links: () => ({ id: 'links', items: state.links }),
      paths: () => ({ id: 'paths', items: state.paths }),
      dailyStats: () => ({ id: 'dailyStats', items: state.dailyStats })
    };
    await PlumeDB.put('meta', map[id]());
  }

  function allStatuses() {
    return [...STATUSES, ...(state.settings.customStatuses || [])];
  }

  const statusById = (id) => allStatuses().find((s) => s.id === id) || STATUSES[1];

  // ---------- init & migration ----------

  async function init() {
    const [articles, images, metas] = await Promise.all([
      PlumeDB.all('articles'), PlumeDB.all('images'), PlumeDB.all('meta')
    ]);
    const meta = Object.fromEntries(metas.map((m) => [m.id, m]));
    state.articles = articles;
    state.images = images;
    state.settings = { ...DEFAULT_SETTINGS, ...(meta.settings || {}) };
    delete state.settings.id;
    state.categories = meta.categories?.items || [];
    state.tags = meta.tags?.items || [];
    state.collections = meta.collections?.items || [];
    state.templates = meta.templates?.items || [];
    state.views = meta.views?.items || [];
    state.links = meta.links?.items || [];
    state.paths = meta.paths?.items || [];
    state.dailyStats = meta.dailyStats?.items || {};

    if (!meta.settings) await firstRun();
    await migrateLegacy();
    await migrateEmojiIcons();
    await purgeExpiredTrash();
    state.ready = true;
    emit();
  }

  async function firstRun() {
    // starter categories
    const mk = (name, icon, parentId = '') => ({ id: MD.uid('cat'), name, icon, color: '', parentId, order: state.categories.length, description: '' });
    const creation = mk('创作', 'feather');
    const life = mk('生活', 'leaf');
    const research = mk('研究', 'flask');
    state.categories.push(creation, life, research, mk('随笔', '', creation.id), mk('日记', '', life.id), mk('论文笔记', '', research.id));

    state.templates = BUILTIN_TEMPLATES.map((t) => ({
      id: MD.uid('tpl'), name: t.name, icon: t.icon, description: t.desc, builtin: true,
      blocks: MD.parse(t.md), defaults: { status: t.status, categoryId: '', tags: [], theme: '' }
    }));

    const welcome = blankArticle({
      title: '欢迎使用 Plume Studio',
      digest: '一个安静的本地写作工作台:你的所有文章、图片和分类都保存在这台设备的浏览器里。',
      categoryId: creation.id,
      tags: ['指南'],
      status: 'done',
      blocks: MD.parse([
        '这里是你的写作工作台。所有内容都存储在本地浏览器(IndexedDB)中,**不需要配置任何 API,也不会上传到任何服务器**。',
        '## 从这里开始',
        '- 左侧边栏管理**分类、标签与合集**,建立自己的内容结构',
        '- 点击右上角「新建文章」,或在首页从**模板**创建',
        '- 编辑时把鼠标移到段落左侧,会出现 **⁝⁝ 拖拽手柄**和 **+ 插入按钮**',
        '- 支持 Markdown 快捷输入:`# 空格` 变标题、`- 空格` 变列表、`> 空格` 变引用',
        '- 按 `⌘/Ctrl + K` 全局搜索,编辑器内点右上角进入**专注模式**',
        '## 图片与排版',
        '直接**拖拽或粘贴图片**到正文,图片会进入素材库,可以裁剪、加圆角、并排、做成网格或对比图。写完后点「预览」,为文章挑一个阅读主题。',
        '## 数据安全',
        '设置页可以**一键导出全部数据**(JSON 备份)或把单篇文章导出为 Markdown、HTML、PDF。建议定期备份。'
      ].join('\n\n'))
    });
    state.articles.push(welcome);
    await Promise.all([
      PlumeDB.put('articles', welcome),
      saveMeta('categories'), saveMeta('templates'), saveMeta('settings')
    ]);
  }

  // Earlier builds stored emoji as category/template icons; convert them to
  // line-icon names (unknown emoji simply drop back to the default icon).
  async function migrateEmojiIcons() {
    const MAP = {
      '✏️': 'pen', '📝': 'pen', '✍️': 'feather', '🌿': 'leaf', '🔬': 'flask', '🧪': 'flask',
      '📔': 'notebook', '📚': 'bookOpen', '📄': 'file', '🗓️': 'calendar', '🧭': 'compass',
      '📷': 'camera', '🎙️': 'mic', '📐': 'ruler', '🎇': 'chart', '📊': 'chart', '💡': 'bulb',
      '🎨': 'pen', '🎵': 'music', '🏔️': 'mountain', '☕': 'coffee', '🍜': 'coffee',
      '🚀': 'sparkle', '❤️': 'heart', '🧠': 'bulb', '🗂️': 'folder', '🌙': 'moon', '⭐': 'star'
    };
    let catsDirty = false;
    let tplsDirty = false;
    const fix = (item) => {
      if (item.icon && /[^\x20-\x7E]/.test(item.icon)) {
        item.icon = MAP[item.icon] || '';
        return true;
      }
      return false;
    };
    for (const c of state.categories) if (fix(c)) catsDirty = true;
    for (const t of state.templates) if (fix(t)) tplsDirty = true;
    if (catsDirty) await saveMeta('categories');
    if (tplsDirty) await saveMeta('templates');
  }

  // Import articles from the pre-rebuild localStorage store, once.
  async function migrateLegacy() {
    if (localStorage.getItem('plume2-migrated')) return;
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem('plume-data') || 'null'); } catch { /* ignore */ }
    if (legacy?.articles?.length) {
      for (const old of legacy.articles) {
        if (state.articles.some((a) => a.id === old.id)) continue;
        const article = blankArticle({
          title: old.title || '未命名',
          digest: old.digest || '',
          blocks: MD.parse(old.contentMarkdown || ''),
          status: 'draft'
        });
        article.id = old.id;
        article.createdAt = old.createdAt || article.createdAt;
        article.updatedAt = old.updatedAt || article.updatedAt;
        if (old.coverPath?.startsWith('data:')) article.cover = old.coverPath;
        Object.assign(article, computeStats(article));
        state.articles.push(article);
        await PlumeDB.put('articles', article);
      }
    }
    localStorage.setItem('plume2-migrated', '1');
  }

  // ---------- articles ----------

  function computeStats(article) {
    const s = MD.stats(article.blocks || []);
    return { wordCount: s.words, charCount: s.chars, paragraphs: s.paragraphs, readMinutes: s.readMinutes };
  }

  function blankArticle(init = {}) {
    const ts = now();
    return {
      id: MD.uid('a'),
      title: '', digest: '', cover: '',
      blocks: [MD.block('p')],
      status: 'draft',
      categoryId: '', extraCategoryIds: [],
      tags: [],
      theme: '',
      pinned: false, favorite: false,
      priority: 0, dueDate: '', targetWords: 0,
      wordCount: 0, charCount: 0, paragraphs: 0, readMinutes: 0,
      createdAt: ts, updatedAt: ts, deletedAt: '',
      lastVersionAt: '', lastVersionWords: 0,
      ...init
    };
  }

  const article = (id) => state.articles.find((a) => a.id === id) || null;
  const liveArticles = () => state.articles.filter((a) => !a.deletedAt);
  const trashedArticles = () => state.articles.filter((a) => a.deletedAt);

  async function createArticle(init = {}) {
    const a = blankArticle(init);
    Object.assign(a, computeStats(a));
    if (!a.status) a.status = 'draft';
    for (const t of a.tags || []) ensureTag(t, { silent: true });
    state.articles.unshift(a);
    await PlumeDB.put('articles', a);
    await saveMeta('tags');
    emit();
    return a;
  }

  async function createFromTemplate(templateId) {
    const tpl = state.templates.find((t) => t.id === templateId);
    if (!tpl) return createArticle();
    return createArticle({
      blocks: JSON.parse(JSON.stringify(tpl.blocks || [MD.block('p')])).map((b) => ({ ...b, id: MD.uid() })),
      status: tpl.defaults?.status || 'draft',
      categoryId: tpl.defaults?.categoryId || '',
      tags: [...(tpl.defaults?.tags || [])],
      theme: tpl.defaults?.theme || ''
    });
  }

  // Update fields; content updates recompute stats, feed daily word log and
  // create periodic version snapshots.
  async function updateArticle(id, patch, { touch = true } = {}) {
    const a = article(id);
    if (!a) return null;
    const contentChanged = 'blocks' in patch || 'title' in patch;
    const prevWords = a.wordCount || 0;
    Object.assign(a, patch);
    if (touch) a.updatedAt = now();
    if ('blocks' in patch) {
      Object.assign(a, computeStats(a));
      const delta = (a.wordCount || 0) - prevWords;
      if (delta > 0) {
        const key = today();
        state.dailyStats[key] = (state.dailyStats[key] || 0) + delta;
        saveMeta('dailyStats');
      }
      await maybeSnapshot(a);
    }
    if ('tags' in patch) {
      for (const t of a.tags || []) ensureTag(t, { silent: true });
      await saveMeta('tags');
    }
    await PlumeDB.put('articles', a);
    emit();
    return a;
  }

  async function duplicateArticle(id) {
    const a = article(id);
    if (!a) return null;
    const copy = JSON.parse(JSON.stringify(a));
    copy.id = MD.uid('a');
    copy.title = `${a.title || '未命名'}(副本)`;
    copy.createdAt = now(); copy.updatedAt = now();
    copy.blocks = (copy.blocks || []).map((b) => ({ ...b, id: MD.uid() }));
    copy.pinned = false;
    state.articles.unshift(copy);
    await PlumeDB.put('articles', copy);
    emit();
    return copy;
  }

  async function trashArticle(id) {
    await updateArticle(id, { deletedAt: now(), pinned: false }, { touch: false });
  }
  async function restoreArticle(id) {
    await updateArticle(id, { deletedAt: '' }, { touch: false });
  }
  async function purgeArticle(id) {
    const idx = state.articles.findIndex((a) => a.id === id);
    if (idx < 0) return;
    state.articles.splice(idx, 1);
    for (const v of await PlumeDB.byIndex('versions', 'articleId', id)) await PlumeDB.del('versions', v.id);
    await PlumeDB.del('articles', id);
    emit();
  }
  async function purgeExpiredTrash() {
    const days = state.settings.trashDays || 30;
    const cutoff = Date.now() - days * 86400000;
    for (const a of trashedArticles()) {
      if (new Date(a.deletedAt).getTime() < cutoff) await purgeArticle(a.id);
    }
  }

  // ---------- versions ----------

  const VERSION_INTERVAL_MS = 8 * 60 * 1000;
  const VERSION_MIN_DELTA = 30;
  const MAX_VERSIONS = 50;

  async function maybeSnapshot(a) {
    const last = a.lastVersionAt ? new Date(a.lastVersionAt).getTime() : 0;
    const delta = Math.abs((a.wordCount || 0) - (a.lastVersionWords || 0));
    if (Date.now() - last < VERSION_INTERVAL_MS || delta < VERSION_MIN_DELTA) return;
    await snapshot(a.id, '');
  }

  async function snapshot(articleId, name = '') {
    const a = article(articleId);
    if (!a) return null;
    const v = {
      id: MD.uid('v'), articleId, name,
      title: a.title, blocks: JSON.parse(JSON.stringify(a.blocks || [])),
      wordCount: a.wordCount || 0, createdAt: now()
    };
    await PlumeDB.put('versions', v);
    a.lastVersionAt = v.createdAt;
    a.lastVersionWords = a.wordCount || 0;
    await PlumeDB.put('articles', a);
    // cap history (unnamed versions go first)
    const all = (await PlumeDB.byIndex('versions', 'articleId', articleId))
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    let excess = all.length - MAX_VERSIONS;
    for (const old of all) {
      if (excess <= 0) break;
      if (!old.name) { await PlumeDB.del('versions', old.id); excess--; }
    }
    return v;
  }

  const versionsOf = (articleId) =>
    PlumeDB.byIndex('versions', 'articleId', articleId).then((list) => list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  async function restoreVersion(articleId, versionId) {
    const v = await PlumeDB.get('versions', versionId);
    if (!v) return;
    await snapshot(articleId, '恢复前自动备份');
    await updateArticle(articleId, { title: v.title, blocks: JSON.parse(JSON.stringify(v.blocks)) });
  }

  // ---------- categories ----------

  const category = (id) => state.categories.find((c) => c.id === id) || null;
  const childCategories = (parentId = '') =>
    state.categories.filter((c) => (c.parentId || '') === parentId).sort((a, b) => (a.order || 0) - (b.order || 0));

  function categoryDescendants(id) {
    const out = [id];
    for (const child of state.categories.filter((c) => c.parentId === id)) out.push(...categoryDescendants(child.id));
    return out;
  }

  function categoryPath(id) {
    const parts = [];
    let cur = category(id);
    let guard = 0;
    while (cur && guard++ < 10) { parts.unshift(cur.name); cur = category(cur.parentId); }
    return parts.join(' / ');
  }

  async function saveCategory(cat) {
    const existing = category(cat.id);
    if (existing) Object.assign(existing, cat);
    else state.categories.push({ id: MD.uid('cat'), name: '未命名分类', parentId: '', order: state.categories.length, icon: '', color: '', description: '', ...cat });
    await saveMeta('categories');
    emit();
  }

  async function deleteCategory(id) {
    const ids = new Set(categoryDescendants(id));
    state.categories = state.categories.filter((c) => !ids.has(c.id));
    for (const a of state.articles) {
      let dirty = false;
      if (ids.has(a.categoryId)) { a.categoryId = ''; dirty = true; }
      const extras = (a.extraCategoryIds || []).filter((cid) => !ids.has(cid));
      if (extras.length !== (a.extraCategoryIds || []).length) { a.extraCategoryIds = extras; dirty = true; }
      if (dirty) await PlumeDB.put('articles', a);
    }
    await saveMeta('categories');
    emit();
  }

  async function mergeCategory(fromId, intoId) {
    for (const a of state.articles) {
      if (a.categoryId === fromId) { a.categoryId = intoId; await PlumeDB.put('articles', a); }
    }
    for (const c of state.categories) if (c.parentId === fromId) c.parentId = intoId;
    state.categories = state.categories.filter((c) => c.id !== fromId);
    await saveMeta('categories');
    emit();
  }

  async function moveCategory(id, newParentId, beforeId = '') {
    const cat = category(id);
    if (!cat || categoryDescendants(id).includes(newParentId)) return;
    cat.parentId = newParentId || '';
    const siblings = childCategories(newParentId).filter((c) => c.id !== id);
    const idx = beforeId ? siblings.findIndex((c) => c.id === beforeId) : siblings.length;
    siblings.splice(idx < 0 ? siblings.length : idx, 0, cat);
    siblings.forEach((c, i) => { c.order = i; });
    await saveMeta('categories');
    emit();
  }

  // ---------- tags ----------

  const tagByName = (name) => state.tags.find((t) => t.name === name) || null;

  function ensureTag(name, { silent = false } = {}) {
    name = String(name || '').trim();
    if (!name || tagByName(name)) return;
    state.tags.push({ id: MD.uid('t'), name, color: '' });
    if (!silent) { saveMeta('tags'); emit(); }
  }

  const tagUsage = (name) => liveArticles().filter((a) => (a.tags || []).includes(name)).length;

  async function renameTag(oldName, newName) {
    newName = String(newName || '').trim();
    if (!newName || oldName === newName) return;
    const existing = tagByName(newName);
    const tag = tagByName(oldName);
    if (existing && tag) state.tags = state.tags.filter((t) => t.id !== tag.id); // merge
    else if (tag) tag.name = newName;
    for (const a of state.articles) {
      if ((a.tags || []).includes(oldName)) {
        a.tags = [...new Set(a.tags.map((t) => (t === oldName ? newName : t)))];
        await PlumeDB.put('articles', a);
      }
    }
    await saveMeta('tags');
    emit();
  }

  async function deleteTag(name) {
    state.tags = state.tags.filter((t) => t.name !== name);
    for (const a of state.articles) {
      if ((a.tags || []).includes(name)) {
        a.tags = a.tags.filter((t) => t !== name);
        await PlumeDB.put('articles', a);
      }
    }
    await saveMeta('tags');
    emit();
  }

  async function setTagColor(name, color) {
    const tag = tagByName(name);
    if (tag) { tag.color = color; await saveMeta('tags'); emit(); }
  }

  // ---------- collections ----------

  const collection = (id) => state.collections.find((c) => c.id === id) || null;

  async function saveCollection(col) {
    const existing = collection(col.id);
    if (existing) Object.assign(existing, col);
    else state.collections.push({ id: MD.uid('col'), name: '未命名合集', intro: '', cover: '', chapters: [], items: [], ...col });
    await saveMeta('collections');
    emit();
  }

  async function deleteCollection(id) {
    state.collections = state.collections.filter((c) => c.id !== id);
    await saveMeta('collections');
    emit();
  }

  async function addToCollection(collectionId, articleId, chapterId = '') {
    const col = collection(collectionId);
    if (!col || col.items.some((item) => item.articleId === articleId)) return;
    col.items.push({ articleId, chapterId });
    await saveMeta('collections');
    emit();
  }

  async function removeFromCollection(collectionId, articleId) {
    const col = collection(collectionId);
    if (!col) return;
    col.items = col.items.filter((item) => item.articleId !== articleId);
    await saveMeta('collections');
    emit();
  }

  const collectionsOf = (articleId) => state.collections.filter((c) => c.items.some((item) => item.articleId === articleId));

  // ---------- templates ----------

  async function saveTemplate(tpl) {
    const existing = state.templates.find((t) => t.id === tpl.id);
    if (existing) Object.assign(existing, tpl);
    else state.templates.push({ id: MD.uid('tpl'), name: '未命名模板', icon: 'file', description: '', blocks: [MD.block('p')], defaults: {}, ...tpl });
    await saveMeta('templates');
    emit();
  }

  async function deleteTemplate(id) {
    state.templates = state.templates.filter((t) => t.id !== id);
    await saveMeta('templates');
    emit();
  }

  async function articleToTemplate(articleId) {
    const a = article(articleId);
    if (!a) return null;
    const tpl = {
      id: MD.uid('tpl'),
      name: a.title || '未命名模板', icon: 'file', description: a.digest || '',
      blocks: JSON.parse(JSON.stringify(a.blocks || [])),
      defaults: { status: a.status, categoryId: a.categoryId, tags: [...(a.tags || [])], theme: a.theme }
    };
    state.templates.push(tpl);
    await saveMeta('templates');
    emit();
    return tpl;
  }

  // ---------- article relations (knowledge graph) ----------

  const LINK_TYPES = [
    { id: 'reference', name: '引用', directed: true },
    { id: 'extends', name: '延伸', directed: true },
    { id: 'prereq', name: '前置阅读', directed: true },
    { id: 'supplement', name: '补充', directed: false },
    { id: 'contrast', name: '对比', directed: false },
    { id: 'rebut', name: '反驳', directed: true },
    { id: 'project', name: '同项目', directed: false },
    { id: 'custom', name: '自定义', directed: false }
  ];

  async function addLink(fromId, toId, type = 'reference', label = '') {
    if (!fromId || !toId || fromId === toId) return null;
    if (state.links.some((l) => l.fromId === fromId && l.toId === toId && l.type === type)) return null;
    const meta = LINK_TYPES.find((t) => t.id === type) || LINK_TYPES[0];
    const link = { id: MD.uid('lnk'), fromId, toId, type, label, directed: meta.directed, createdAt: now() };
    state.links.push(link);
    await saveMeta('links');
    emit();
    return link;
  }

  async function deleteLink(id) {
    state.links = state.links.filter((l) => l.id !== id);
    await saveMeta('links');
    emit();
  }

  const linksOf = (articleId) => state.links.filter((l) => l.fromId === articleId || l.toId === articleId);

  // [[Title]] wiki references parsed out of article text
  function wikiRefs(articleId) {
    const a = article(articleId);
    if (!a) return [];
    const titles = [...MD.textOf(a.blocks || []).matchAll(/\[\[([^\[\]\n]+)\]\]/g)].map((m) => m[1].trim());
    const seen = new Set();
    const out = [];
    for (const t of titles) {
      const target = liveArticles().find((x) => (x.title || '').trim() === t);
      if (target && target.id !== articleId && !seen.has(target.id)) {
        seen.add(target.id);
        out.push(target);
      }
    }
    return out;
  }

  function backlinksOf(articleId) {
    const fromWiki = liveArticles().filter((a) => a.id !== articleId && wikiRefs(a.id).some((t) => t.id === articleId));
    const fromLinks = state.links
      .filter((l) => l.toId === articleId)
      .map((l) => article(l.fromId))
      .filter((a) => a && !a.deletedAt);
    const seen = new Set();
    return [...fromWiki, ...fromLinks].filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));
  }

  // rule-based suggestions (no AI): shared tags / category / collection /
  // title keyword overlap / edited around the same time
  function suggestRelated(articleId, limit = 6) {
    const a = article(articleId);
    if (!a) return [];
    const linked = new Set([articleId, ...linksOf(articleId).flatMap((l) => [l.fromId, l.toId]), ...wikiRefs(articleId).map((t) => t.id)]);
    const aWords = new Set((a.title || '').split(/[\s,。,、::\-—/]+/).filter((w) => w.length >= 2));
    const aCols = collectionsOf(articleId).map((c) => c.id);
    const scored = [];
    for (const b of liveArticles()) {
      if (linked.has(b.id)) continue;
      let score = 0;
      const reasons = [];
      const sharedTags = (a.tags || []).filter((t) => (b.tags || []).includes(t));
      if (sharedTags.length) { score += sharedTags.length * 2; reasons.push(`共同标签:${sharedTags.slice(0, 2).join('、')}`); }
      if (a.categoryId && a.categoryId === b.categoryId) { score += 1.5; reasons.push('同分类'); }
      if (aCols.some((cid) => collectionsOf(b.id).some((c) => c.id === cid))) { score += 2; reasons.push('同合集'); }
      const bWords = (b.title || '').split(/[\s,。,、::\-—/]+/).filter((w) => w.length >= 2);
      const overlap = bWords.filter((w) => aWords.has(w));
      if (overlap.length) { score += overlap.length * 1.2; reasons.push(`标题关键词:${overlap[0]}`); }
      const dt = Math.abs(new Date(a.updatedAt) - new Date(b.updatedAt));
      if (dt < 3 * 86400000) { score += 0.5; reasons.push('近期同时编辑'); }
      if (score >= 1.5) scored.push({ article: b, score, reason: reasons.join(' · ') });
    }
    return scored.sort((x, y) => y.score - x.score).slice(0, limit);
  }

  // ---------- thought paths ----------

  async function savePath(p) {
    const existing = state.paths.find((x) => x.id === p.id);
    if (existing) Object.assign(existing, p);
    else state.paths.push({ id: MD.uid('path'), name: '未命名路径', intro: '', readingMode: '', items: [], createdAt: now(), ...p });
    await saveMeta('paths');
    emit();
  }

  async function deletePath(id) {
    state.paths = state.paths.filter((p) => p.id !== id);
    await saveMeta('paths');
    emit();
  }

  const pathsOf = (articleId) => state.paths.filter((p) => (p.items || []).includes(articleId));

  // ---------- saved views ----------

  async function saveView(view) {
    const existing = state.views.find((v) => v.id === view.id);
    if (existing) Object.assign(existing, view);
    else state.views.push({ id: MD.uid('view'), name: '智能视图', filter: {}, ...view });
    await saveMeta('views');
    emit();
  }

  async function deleteView(id) {
    state.views = state.views.filter((v) => v.id !== id);
    await saveMeta('views');
    emit();
  }

  // ---------- images ----------

  const urlCache = new Map();

  const image = (id) => state.images.find((img) => img.id === id) || null;

  function imageUrl(ref) {
    if (!ref) return '';
    if (!ref.startsWith('img:')) return ref; // external / data URL
    const id = ref.slice(4);
    if (urlCache.has(id)) return urlCache.get(id);
    const img = image(id);
    if (!img?.blob) return '';
    const url = URL.createObjectURL(img.blob);
    urlCache.set(id, url);
    return url;
  }

  function compressImage(file) {
    const { imgCompress, imgMaxWidth, imgQuality } = state.settings;
    if (!imgCompress || file.type === 'image/gif' || file.type === 'image/svg+xml') return Promise.resolve(file);
    return new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, (imgMaxWidth || 2000) / img.naturalWidth);
        if (scale >= 1 && file.size < 900_000) { resolve(file); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob((blob) => resolve(blob && blob.size < file.size ? blob : file), type, imgQuality || 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
      img.src = objectUrl;
    });
  }

  function imageDimensions(blob) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }); };
      img.src = url;
    });
  }

  async function addImage(file, { folder = '' } = {}) {
    const blob = await compressImage(file);
    const dims = await imageDimensions(blob);
    const entry = {
      id: MD.uid('img'),
      name: file.name || `图片-${today()}.jpg`,
      blob, size: blob.size, type: blob.type || file.type,
      width: dims.width, height: dims.height,
      folder, tags: [], createdAt: now()
    };
    state.images.push(entry);
    await PlumeDB.put('images', entry);
    emit();
    return entry;
  }

  async function updateImage(id, patch) {
    const img = image(id);
    if (!img) return;
    Object.assign(img, patch);
    await PlumeDB.put('images', img);
    emit();
  }

  // Replace binary while keeping the id: every article referencing it updates automatically.
  async function replaceImage(id, file) {
    const img = image(id);
    if (!img) return;
    img.blob = await compressImage(file);
    img.size = img.blob.size;
    img.type = img.blob.type || file.type;
    Object.assign(img, await imageDimensions(img.blob));
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
    await PlumeDB.put('images', img);
    emit();
  }

  async function deleteImage(id) {
    state.images = state.images.filter((img) => img.id !== id);
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
    await PlumeDB.del('images', id);
    emit();
  }

  // which live articles use image `id`
  function imageUsage(id) {
    const ref = `img:${id}`;
    return liveArticles().filter((a) => {
      if (a.cover === ref) return true;
      return (a.blocks || []).some((b) =>
        b.src === ref || (b.items || []).some((item) => item.src === ref));
    });
  }

  // ---------- filtering / search ----------

  function filterArticles(filter = {}) {
    let list = liveArticles();
    if (filter.trashed) list = trashedArticles();
    const q = (filter.q || '').trim().toLowerCase();

    list = list.filter((a) => {
      if (filter.statuses?.length && !filter.statuses.includes(a.status)) return false;
      if (filter.noCategory && a.categoryId) return false;
      if (filter.categoryId) {
        const ids = categoryDescendants(filter.categoryId);
        if (!ids.includes(a.categoryId) && !(a.extraCategoryIds || []).some((cid) => ids.includes(cid))) return false;
      }
      if (filter.tags?.length && !filter.tags.every((t) => (a.tags || []).includes(t))) return false;
      if (filter.collectionId && !collection(filter.collectionId)?.items.some((item) => item.articleId === a.id)) return false;
      if (filter.favorite && !a.favorite) return false;
      if (filter.hasImages && !(a.blocks || []).some((b) => b.type === 'image' || b.type === 'gallery')) return false;
      if (filter.minWords && (a.wordCount || 0) < filter.minWords) return false;
      if (filter.maxWords && (a.wordCount || 0) > filter.maxWords) return false;
      if (filter.updatedWithinDays && Date.now() - new Date(a.updatedAt).getTime() > filter.updatedWithinDays * 86400000) return false;
      if (filter.notUpdatedDays && Date.now() - new Date(a.updatedAt).getTime() < filter.notUpdatedDays * 86400000) return false;
      if (q) {
        const haystack = [
          a.title, a.digest, MD.textOf(a.blocks || []),
          (a.tags || []).join(' '), categoryPath(a.categoryId)
        ].join('\n').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sort = filter.sort || 'updatedAt';
    const dir = filter.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (a.pinned !== b.pinned && !filter.trashed) return a.pinned ? -1 : 1;
      let va = a[sort]; let vb = b[sort];
      if (sort === 'title') { va = va || ''; vb = vb || ''; return va.localeCompare(vb, 'zh') * dir; }
      if (typeof va === 'number' || typeof vb === 'number') return ((va || 0) - (vb || 0)) * dir;
      return String(va || '').localeCompare(String(vb || '')) * dir;
    });
    return list;
  }

  function globalSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) return { articles: [], categories: [], tags: [], collections: [], images: [] };
    const match = (s) => String(s || '').toLowerCase().includes(q);
    return {
      articles: liveArticles().filter((a) => match(a.title) || match(a.digest) || match(MD.textOf(a.blocks || []))).slice(0, 20),
      categories: state.categories.filter((c) => match(c.name) || match(c.description)),
      tags: state.tags.filter((t) => match(t.name)),
      collections: state.collections.filter((c) => match(c.name) || match(c.intro)),
      images: state.images.filter((img) => match(img.name) || (img.tags || []).some(match)).slice(0, 12)
    };
  }

  // ---------- dashboard stats ----------

  function weekWords() {
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      total += state.dailyStats[key] || 0;
    }
    return total;
  }

  function streakDays() {
    let streak = 0;
    for (let i = 0; i < 3650; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (state.dailyStats[key] > 0) streak++;
      else if (i === 0) continue; // today may not have started yet
      else break;
    }
    return streak;
  }

  // ---------- settings ----------

  async function saveSettings(patch) {
    Object.assign(state.settings, patch);
    await saveMeta('settings');
    emit();
  }

  // ---------- backup ----------

  async function exportBackup() {
    const versions = await PlumeDB.all('versions');
    const images = await Promise.all(state.images.map(async (img) => ({
      ...img, blob: undefined,
      dataUrl: await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(img.blob);
      })
    })));
    return {
      app: 'plume-studio', version: 2, exportedAt: now(),
      articles: state.articles, categories: state.categories, tags: state.tags,
      collections: state.collections, templates: state.templates, views: state.views,
      links: state.links, paths: state.paths,
      settings: state.settings, dailyStats: state.dailyStats, versions, images
    };
  }

  async function importBackup(data) {
    if (data?.app !== 'plume-studio') throw new Error('这不是 Plume Studio 的备份文件');
    for (const name of ['articles', 'images', 'versions', 'meta']) await PlumeDB.clear(name);
    for (const a of data.articles || []) await PlumeDB.put('articles', a);
    for (const v of data.versions || []) await PlumeDB.put('versions', v);
    for (const img of data.images || []) {
      const blob = img.dataUrl ? await fetch(img.dataUrl).then((r) => r.blob()) : null;
      if (blob) await PlumeDB.put('images', { ...img, dataUrl: undefined, blob });
    }
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    state.categories = data.categories || [];
    state.tags = data.tags || [];
    state.collections = data.collections || [];
    state.templates = data.templates || [];
    state.views = data.views || [];
    state.links = data.links || [];
    state.paths = data.paths || [];
    state.dailyStats = data.dailyStats || {};
    for (const id of ['settings', 'categories', 'tags', 'collections', 'templates', 'views', 'links', 'paths', 'dailyStats']) await saveMeta(id);
    for (const [id, url] of urlCache) URL.revokeObjectURL(url);
    urlCache.clear();
    state.articles = await PlumeDB.all('articles');
    state.images = await PlumeDB.all('images');
    emit();
  }

  return {
    state, on, init,
    STATUSES, allStatuses, statusById,
    article, liveArticles, trashedArticles,
    createArticle, createFromTemplate, updateArticle, duplicateArticle,
    trashArticle, restoreArticle, purgeArticle,
    snapshot, versionsOf, restoreVersion,
    category, childCategories, categoryDescendants, categoryPath,
    saveCategory, deleteCategory, mergeCategory, moveCategory,
    tagByName, ensureTag, tagUsage, renameTag, deleteTag, setTagColor,
    collection, saveCollection, deleteCollection, addToCollection, removeFromCollection, collectionsOf,
    saveTemplate, deleteTemplate, articleToTemplate,
    saveView, deleteView,
    LINK_TYPES, addLink, deleteLink, linksOf, wikiRefs, backlinksOf, suggestRelated,
    savePath, deletePath, pathsOf,
    image, imageUrl, addImage, updateImage, replaceImage, deleteImage, imageUsage,
    filterArticles, globalSearch, weekWords, streakDays,
    saveSettings, exportBackup, importBackup
  };
})();
