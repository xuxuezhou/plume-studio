/* GitHub private-repo sync. Global: Sync
 *
 * Every sync is a single atomic git commit built from a three-way diff
 * (local / remote / last-synced base), so a failed run leaves the remote
 * untouched and simply retries later — no queue, no half-written state.
 *
 * Layout written to the vault repo:
 *   manifest.json            index of everything, human-readable
 *   articles/<id>.json       source of truth for one article
 *   markdown/<title>--<id6>.md   readable copy (never read back)
 *   meta/<name>.json         categories, tags, templates, settings, …
 *   images/<id>.<ext>        binary originals
 *   versions/<articleId>.json
 *
 * The token lives in its own localStorage key, deliberately NOT in
 * Store.settings, so it can never leak into an exported backup or the
 * localStorage rescue copy.
 */
const Sync = (() => {
  const API = 'https://api.github.com';
  const TOKEN_KEY = 'plume-sync-token';
  const BASE_KEY = 'plume-sync-base';   // { commit, paths: { path: sha } }
  const LAST_KEY = 'plume-sync-last';   // ISO string of last successful sync

  const MANAGED = ['manifest.json', 'articles/', 'markdown/', 'meta/', 'images/', 'versions/'];
  const META_KEYS = ['categories', 'tags', 'collections', 'templates', 'views', 'links', 'paths', 'dailyStats', 'settings'];
  // Device-local config must never travel between devices.
  const LOCAL_ONLY_SETTINGS = ['syncRepo', 'syncBranch', 'syncAuto'];

  const listeners = new Set();
  let status = { state: 'off', message: '未配置云同步', busy: false, error: '' };
  let applying = false;      // suppress auto-sync while writing remote data in
  let timer = null;
  let poller = null;
  let running = null;        // in-flight sync promise (single-flight)

  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = () => listeners.forEach((fn) => { try { fn(status); } catch { /* listener errors are not ours */ } });

  function setStatus(patch) {
    status = { ...status, ...patch };
    emit();
  }

  // ---------- config ----------

  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
  const setToken = (t) => { t ? localStorage.setItem(TOKEN_KEY, t.trim()) : localStorage.removeItem(TOKEN_KEY); refreshStatus(); };
  const repo = () => (Store.state.settings.syncRepo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const branch = () => (Store.state.settings.syncBranch || 'main').trim();
  const autoOn = () => Store.state.settings.syncAuto !== false;
  const configured = () => Boolean(getToken() && repo().includes('/'));
  const lastAt = () => localStorage.getItem(LAST_KEY) || '';

  function loadBase() {
    try {
      const b = JSON.parse(localStorage.getItem(BASE_KEY) || 'null');
      if (b && b.paths) return b;
    } catch { /* corrupt base just means a full re-diff */ }
    return { commit: '', paths: {} };
  }
  const saveBase = (commit, paths) => localStorage.setItem(BASE_KEY, JSON.stringify({ commit, paths }));
  const clearBase = () => localStorage.removeItem(BASE_KEY);

  // ---------- byte helpers ----------

  const te = new TextEncoder();
  const td = new TextDecoder();
  const enc = (str) => te.encode(str);

  function b64encode(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  }

  function b64decode(str) {
    const bin = atob(str.replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // git's blob id: sha1("blob <bytelength>\0" + bytes). Computing it locally
  // lets us diff against the remote tree without downloading anything.
  async function gitBlobSha(bytes) {
    const header = enc(`blob ${bytes.length}\0`);
    const buf = new Uint8Array(header.length + bytes.length);
    buf.set(header, 0);
    buf.set(bytes, header.length);
    const hash = await crypto.subtle.digest('SHA-1', buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- GitHub REST ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
  const backoff = (attempt) => [800, 2500, 6000][attempt] || 6000;

  // Retries transient trouble instead of surfacing it. Every mutating call here
  // is safe to repeat: blobs and trees are content-addressed, a duplicate
  // commit object is unreachable garbage until a ref points at it, and setting
  // a ref to the same sha twice is a no-op.
  async function api(path, { method = 'GET', body, raw = false, attempt = 0 } = {}) {
    const token = getToken();
    if (!token) throw new Error('尚未填写访问令牌');
    const again = () => api(path, { method, body, raw, attempt: attempt + 1 });

    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      // Network-level failure: offline, or a backgrounded tab being throttled.
      if (attempt < 2) { await sleep(backoff(attempt)); return again(); }
      const err = new Error(navigator.onLine === false ? '当前离线,联网后会自动重试' : '网络请求失败,稍后会自动重试');
      err.transient = true;
      throw err;
    }

    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) {
      const secondary = res.status === 403 && /secondary rate limit|abuse detection/i.test(data?.message || '');
      const retryable = RETRY_STATUS.has(res.status) || secondary;
      if (retryable && attempt < 2) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        return again();
      }
      const err = new Error(describeError(res, data, secondary));
      err.status = res.status;
      err.transient = retryable;
      throw err;
    }
    return raw ? text : data;
  }

  function describeError(res, data, secondary = false) {
    const msg = data?.message || res.statusText || '未知错误';
    if (res.status === 401) return '令牌无效或已过期,请在设置里重新填写';
    if (secondary) return 'GitHub 限流(短时间请求过多),稍后会自动重试';
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') return 'GitHub 接口调用次数已达上限,请稍后再试';
    if (res.status === 403) return `没有权限:${msg}(请确认令牌勾选了 Contents 读写)`;
    if (res.status === 404) return '找不到仓库:请检查仓库名,以及令牌是否授权了这个仓库';
    if (res.status === 409) return '仓库里还没有任何提交,请先点「初始化仓库」建立第一个提交';
    if (res.status === 422) return `GitHub 拒绝了这次提交:${msg}`;
    return `${msg}(HTTP ${res.status})`;
  }

  // ---------- diagnostics ----------

  const LOG_KEY = 'plume-sync-log';
  function logEvent(msg, kind = 'error') {
    try {
      const log = errorLog();
      log.unshift({ at: new Date().toISOString(), kind, msg });
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 30)));
    } catch { /* logging must never break a sync */ }
  }
  function errorLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
  }

  // ---------- local snapshot ----------

  const slug = (s) => (s || '未命名')
    .replace(/[\\/:*?"<>|#\[\]]/g, ' ')      // path- and markdown-hostile characters
    .replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名';

  const extFor = (mime) => ({
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif'
  }[mime] || 'bin');

  function frontMatter(a) {
    const cat = Store.category?.(a.categoryId)?.name || '';
    const lines = [
      '---',
      `title: ${JSON.stringify(a.title || '未命名')}`,
      `id: ${a.id}`,
      `status: ${a.status || ''}`,
      cat ? `category: ${JSON.stringify(cat)}` : '',
      a.tags?.length ? `tags: [${a.tags.map((t) => JSON.stringify(t)).join(', ')}]` : '',
      `created: ${a.createdAt || ''}`,
      `updated: ${a.updatedAt || ''}`,
      a.deletedAt ? `trashed: ${a.deletedAt}` : '',
      '---'
    ].filter(Boolean);
    return lines.join('\n');
  }

  // Build every file the vault should contain, keyed by path.
  async function buildLocalFiles() {
    const files = new Map();
    const add = async (path, bytes, binary = false) => {
      files.set(path, { bytes, binary, sha: await gitBlobSha(bytes) });
    };
    const addText = (path, text) => add(path, enc(text), false);

    const arts = Store.state.articles;

    // manifest — the at-a-glance index, first thing you see on github.com
    const manifest = {
      app: 'plume-studio',
      format: 1,
      // Derived from content, never from the clock: a manifest that changed on
      // every build would make every no-op sync produce a commit.
      updatedAt: arts.reduce((max, a) => (a.updatedAt > max ? a.updatedAt : max), ''),
      counts: { articles: arts.filter((a) => !a.deletedAt).length, trashed: arts.filter((a) => a.deletedAt).length, images: Store.state.images.length },
      articles: arts.map((a) => ({
        id: a.id, title: a.title || '未命名', status: a.status,
        category: Store.category?.(a.categoryId)?.name || '',
        tags: a.tags || [], words: a.wordCount || 0,
        createdAt: a.createdAt, updatedAt: a.updatedAt,
        trashed: Boolean(a.deletedAt), file: `articles/${a.id}.json`
      })).sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''))
    };
    await addText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

    for (const a of arts) {
      await addText(`articles/${a.id}.json`, `${JSON.stringify(a, null, 2)}\n`);
      const md = `${frontMatter(a)}\n\n# ${a.title || '未命名'}\n\n${MD.blocksToMarkdown(a.blocks || [])}\n`;
      await addText(`markdown/${slug(a.title)}--${a.id.slice(-6)}.md`, md);
    }

    for (const key of META_KEYS) {
      let value = key === 'settings'
        ? Object.fromEntries(Object.entries(Store.state.settings).filter(([k]) => !LOCAL_ONLY_SETTINGS.includes(k)))
        : Store.state[key];
      if (value === undefined) value = key === 'dailyStats' || key === 'settings' ? {} : [];
      await addText(`meta/${key}.json`, `${JSON.stringify(value, null, 2)}\n`);
    }

    const imgMeta = [];
    for (const img of Store.state.images) {
      const mime = img.blob?.type || img.mime || 'image/png';
      const path = `images/${img.id}.${extFor(mime)}`;
      imgMeta.push({ ...img, blob: undefined, mime, file: path });
      if (img.blob) await add(path, new Uint8Array(await img.blob.arrayBuffer()), true);
    }
    await addText('meta/images.json', `${JSON.stringify(imgMeta, null, 2)}\n`);

    const versions = await PlumeDB.all('versions');
    const byArticle = new Map();
    for (const v of versions) {
      if (!byArticle.has(v.articleId)) byArticle.set(v.articleId, []);
      byArticle.get(v.articleId).push(v);
    }
    for (const [articleId, list] of byArticle) {
      await addText(`versions/${articleId}.json`, `${JSON.stringify(list, null, 2)}\n`);
    }

    return files;
  }

  const isManaged = (path) => MANAGED.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));

  // ---------- remote snapshot ----------

  async function remoteTree() {
    let ref;
    try {
      ref = await api(`/repos/${repo()}/git/ref/heads/${encodeURIComponent(branch())}`);
    } catch (err) {
      if (err.status === 404 || err.status === 409) return { commit: '', paths: {}, empty: true };
      throw err;
    }
    const commit = ref.object.sha;
    const commitObj = await api(`/repos/${repo()}/git/commits/${commit}`);
    const tree = await api(`/repos/${repo()}/git/trees/${commitObj.tree.sha}?recursive=1`);
    const paths = {};
    for (const entry of tree.tree || []) {
      if (entry.type === 'blob') paths[entry.path] = entry.sha;
    }
    if (tree.truncated) throw new Error('仓库文件过多,超出单次读取上限');
    return { commit, paths, treeSha: commitObj.tree.sha, empty: false };
  }

  async function fetchBlob(sha) {
    const blob = await api(`/repos/${repo()}/git/blobs/${sha}`);
    return b64decode(blob.content || '');
  }

  // ---------- writing a commit ----------

  async function commitChanges(remote, changes, message) {
    if (!changes.length) return remote.commit;
    const tree = [];
    for (const c of changes) {
      if (c.delete) {
        tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
      } else if (c.binary) {
        const blob = await api(`/repos/${repo()}/git/blobs`, { method: 'POST', body: { content: b64encode(c.bytes), encoding: 'base64' } });
        tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
      } else {
        tree.push({ path: c.path, mode: '100644', type: 'blob', content: td.decode(c.bytes) });
      }
    }
    const newTree = await api(`/repos/${repo()}/git/trees`, {
      method: 'POST',
      body: remote.treeSha ? { base_tree: remote.treeSha, tree } : { tree }
    });
    const commit = await api(`/repos/${repo()}/git/commits`, {
      method: 'POST',
      body: { message, tree: newTree.sha, parents: remote.commit ? [remote.commit] : [] }
    });
    const refPath = `/repos/${repo()}/git/refs/heads/${encodeURIComponent(branch())}`;
    if (remote.commit) {
      await api(refPath, { method: 'PATCH', body: { sha: commit.sha } });
    } else {
      await api(`/repos/${repo()}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch()}`, sha: commit.sha } });
    }
    return commit.sha;
  }

  // ---------- applying remote data locally ----------

  async function applyRemoteFiles(remote, paths) {
    const payload = { articles: [], meta: {}, images: [] };
    for (const path of paths) {
      const sha = remote.paths[path];
      if (!sha) continue;
      const bytes = await fetchBlob(sha);
      if (path.startsWith('articles/') && path.endsWith('.json')) {
        try { payload.articles.push(JSON.parse(td.decode(bytes))); } catch { /* skip unreadable file */ }
      } else if (path.startsWith('meta/') && path.endsWith('.json')) {
        const name = path.slice(5, -5);
        try { payload.meta[name] = JSON.parse(td.decode(bytes)); } catch { /* skip */ }
      } else if (path.startsWith('images/')) {
        const id = path.slice(7).replace(/\.[^.]+$/, '');
        payload.images.push({ id, bytes });
      } else if (path.startsWith('versions/') && path.endsWith('.json')) {
        try {
          for (const v of JSON.parse(td.decode(bytes))) await PlumeDB.put('versions', v);
        } catch { /* skip */ }
      }
    }
    // Turn raw image bytes into blobs using the metadata file if we got one.
    const imgMeta = payload.meta.images || [];
    payload.images = payload.images.map((img) => {
      const meta = imgMeta.find((m) => m.id === img.id) || {};
      return { ...meta, id: img.id, blob: new Blob([img.bytes], { type: meta.mime || 'image/png' }) };
    });
    delete payload.meta.images;

    applying = true;
    try {
      await Store.applyRemote(payload);
    } finally {
      applying = false;
    }
  }

  // ---------- the sync itself ----------

  async function syncNow({ silent = false, bestEffort = false } = {}) {
    if (running) return running;
    if (!configured()) {
      setStatus({ state: 'off', message: '未配置云同步' });
      return null;
    }
    const previous = status;
    running = (async () => {
      setStatus({ state: 'syncing', message: '同步中…', busy: true, error: '' });
      try {
        let result;
        try {
          result = await performSync(silent);
        } catch (err) {
          // Another device (or tab) moved the branch under us — re-read and
          // rebuild the diff once rather than reporting a failure.
          if (err.status === 422 || err.status === 409) {
            logEvent(`分支被其他设备更新,重试一次:${err.message}`, 'retry');
            result = await performSync(silent);
          } else throw err;
        }
        localStorage.setItem(LAST_KEY, new Date().toISOString());
        const note = result.conflicts ? `已同步(${result.conflicts} 处冲突已保留为副本)` : '已同步';
        setStatus({ state: 'idle', message: note, busy: false, error: '' });
        if (!silent && result.conflicts) UI.toast(`同步完成,${result.conflicts} 篇文章存在冲突,云端版本已另存为副本`, 'warn');
        return result;
      } catch (err) {
        logEvent(err.message || '同步失败');
        // A best-effort run (page going to the background, where the browser
        // throttles network) must not paint a scary red state: the next
        // foreground sync picks the work up untouched.
        if (bestEffort) setStatus({ ...previous, busy: false });
        else setStatus({ state: 'error', message: err.message || '同步失败', busy: false, error: err.message || '' });
        if (!silent) UI.toast(`同步失败:${err.message}`, 'error');
        throw err;
      } finally {
        running = null;
      }
    })();
    return running.catch(() => null);
  }

  async function performSync(silent) {
    {
      {
        const remote = await remoteTree();
        if (remote.empty) throw new Error('仓库还是空的,请先点「初始化仓库」');
        const base = loadBase();
        const local = await buildLocalFiles();

        const allPaths = new Set([...local.keys(), ...Object.keys(remote.paths).filter(isManaged)]);
        const toPull = [];
        const changes = [];
        const conflicts = [];

        for (const path of allPaths) {
          const l = local.get(path)?.sha || null;
          const r = remote.paths[path] || null;
          const b = base.paths[path] || null;
          if (l === r) continue;                       // already in agreement
          if (l === b) { toPull.push(path); continue; } // only remote moved
          if (r === b) {                                // only local moved
            const f = local.get(path);
            changes.push(f ? { path, bytes: f.bytes, binary: f.binary } : { path, delete: true });
            continue;
          }
          // both moved — never silently drop either side
          if (path.startsWith('articles/')) conflicts.push(path);
          else if (local.has(path)) changes.push({ path, bytes: local.get(path).bytes, binary: local.get(path).binary });
          else toPull.push(path);
        }

        if (conflicts.length) {
          // Pull the remote copy in as a separate article; the local one stays put.
          for (const path of conflicts) {
            const bytes = await fetchBlob(remote.paths[path]);
            let a = null;
            try { a = JSON.parse(td.decode(bytes)); } catch { continue; }
            const stamp = UI.fmtDateTime ? UI.fmtDateTime(new Date().toISOString()) : new Date().toLocaleString();
            applying = true;
            try {
              await Store.applyRemote({
                articles: [{ ...a, id: `${a.id}_conflict_${Date.now().toString(36)}`, title: `${a.title || '未命名'}(云端冲突副本 ${stamp})` }]
              });
            } finally { applying = false; }
          }
        }

        if (toPull.length) await applyRemoteFiles(remote, toPull);

        // Local data may have changed (pull / conflict copies) — rebuild before pushing.
        let head = remote.commit;
        let finalRemote = remote;
        if (toPull.length || conflicts.length) {
          finalRemote = await remoteTree();
          const rebuilt = await buildLocalFiles();
          const push = [];
          for (const [path, f] of rebuilt) {
            if (finalRemote.paths[path] !== f.sha) push.push({ path, bytes: f.bytes, binary: f.binary });
          }
          for (const path of Object.keys(finalRemote.paths)) {
            if (isManaged(path) && !rebuilt.has(path)) push.push({ path, delete: true });
          }
          head = await commitChanges(finalRemote, push, commitMessage(push));
          const map = {};
          for (const [path, f] of rebuilt) map[path] = f.sha;
          saveBase(head, map);
        } else {
          head = await commitChanges(remote, changes, commitMessage(changes));
          const map = {};
          for (const [path, f] of local.entries()) map[path] = f.sha;
          for (const path of Object.keys(remote.paths)) if (isManaged(path) && !local.has(path)) delete map[path];
          saveBase(head, map);
        }

        return { pulled: toPull.length, pushed: changes.length, conflicts: conflicts.length };
      }
    }
  }

  function commitMessage(changes) {
    const n = changes.length;
    const dev = navigator.platform || 'web';
    return `Plume 同步:${n} 个文件更新 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · ${dev}`;
  }

  // ---------- one-off operations ----------

  async function test() {
    const info = await api(`/repos/${repo()}`);
    if (!info.permissions?.push) throw new Error('这个令牌对该仓库没有写入权限');
    return {
      full: info.full_name,
      private: info.private,
      empty: info.size === 0,
      defaultBranch: info.default_branch
    };
  }

  // Create the first commit so the repo has a branch to build on.
  async function initRepo() {
    const remote = await remoteTree();
    if (!remote.empty && Object.keys(remote.paths).length) return { already: true };
    const readme = [
      '# Plume 文章保险库',
      '',
      '这个仓库由 [Plume Studio](https://xuxuezhou.github.io/plume-studio/) 自动维护,请勿手动修改 `articles/` 和 `meta/` 下的文件。',
      '',
      '- `manifest.json` — 全部文章的索引',
      '- `markdown/` — **可以直接在 GitHub 上阅读的文章正文**',
      '- `articles/` — 结构化原文(同步的真源)',
      '- `images/` — 图片原件',
      '',
      '每一次同步都是一个 commit,可以通过 git 历史回到任意时间点。',
      ''
    ].join('\n');
    clearBase();
    // A repository with no commits rejects the git-data API outright (409), so
    // the very first file has to go through the contents API — which also
    // creates the branch for us.
    try {
      await api(`/repos/${repo()}/contents/README.md`, {
        method: 'PUT',
        body: { message: 'Plume:初始化保险库', content: b64encode(enc(readme)), branch: branch() }
      });
    } catch (err) {
      if (err.status === 404) {
        const info = await api(`/repos/${repo()}`).catch(() => null);
        if (info && info.default_branch !== branch()) {
          throw new Error(`仓库的默认分支是 ${info.default_branch},请把设置里的分支改成它`);
        }
      }
      throw err;
    }
    return { already: false };
  }

  // Pull everything from the vault, overwriting local copies with the same id.
  async function restoreAll() {
    const remote = await remoteTree();
    if (remote.empty) throw new Error('云端仓库还是空的,没有可恢复的内容');
    const paths = Object.keys(remote.paths).filter((p) => isManaged(p) && !p.startsWith('markdown/'));
    if (!paths.length) throw new Error('云端没有找到 Plume 的备份数据');
    setStatus({ state: 'syncing', message: '正在从云端恢复…', busy: true });
    await applyRemoteFiles(remote, paths);
    const local = await buildLocalFiles();
    const map = {};
    for (const [path, f] of local.entries()) map[path] = f.sha;
    saveBase(remote.commit, map);
    localStorage.setItem(LAST_KEY, new Date().toISOString());
    setStatus({ state: 'idle', message: '已从云端恢复', busy: false });
    return { files: paths.length };
  }

  async function history(limit = 20) {
    const list = await api(`/repos/${repo()}/commits?sha=${encodeURIComponent(branch())}&per_page=${limit}`);
    return (list || []).map((c) => ({
      sha: c.sha, short: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      date: c.commit.author?.date || c.commit.committer?.date || ''
    }));
  }

  // ---------- scheduling ----------

  function scheduleSync(delay = 30000) {
    if (!configured() || !autoOn() || applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow({ silent: true }), delay);
    // An earlier failure shouldn't keep the pill red once a retry is queued.
    if (status.state !== 'syncing') setStatus({ state: 'pending', message: '有改动待同步' });
  }

  function refreshStatus() {
    if (!configured()) return setStatus({ state: 'off', message: '未配置云同步', busy: false });
    const at = lastAt();
    setStatus({ state: 'idle', message: at ? `已同步 · ${UI.fmtRelative ? UI.fmtRelative(at) : at}` : '尚未同步过', busy: false });
  }

  function init() {
    refreshStatus();
    Store.on(() => { if (!applying) scheduleSync(); });

    document.addEventListener('visibilitychange', () => {
      if (!configured() || !autoOn()) return;
      if (document.visibilityState === 'hidden') {
        // Last chance to push pending edits — but the browser throttles network
        // in background tabs, so only bother when something is actually waiting
        // and never let a throttled request count as a real failure.
        if (status.state !== 'pending') return;
        clearTimeout(timer);
        syncNow({ silent: true, bestEffort: true });
      } else {
        // Back in the foreground: settle anything the background run missed.
        scheduleSync(2000);
      }
    });

    // Coming back online is the moment a queued-up failure can finally succeed.
    window.addEventListener('online', () => { if (configured() && autoOn()) scheduleSync(1500); });

    clearInterval(poller);
    poller = setInterval(() => { if (configured() && autoOn() && !document.hidden) syncNow({ silent: true }); }, 10 * 60 * 1000);

    if (configured() && autoOn()) setTimeout(() => syncNow({ silent: true }), 3000);
  }

  return {
    init, on, syncNow, test, initRepo, restoreAll, history, errorLog,
    getToken, setToken, configured, repo, branch, autoOn, lastAt, clearBase,
    get status() { return status; }
  };
})();
