const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_VERSION = 2;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

const dataDir = process.env.WEWRITE_DATA_DIR || path.join(os.homedir(), '.wewrite-studio');
const uploadsDir = path.join(dataDir, 'uploads');
const dataPath = path.join(dataDir, 'data.json');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultArticle(timestamp = nowIso()) {
  return {
    id: createId('article'),
    title: 'Your First Article',
    author: '',
    digest: 'Use this starter draft to get familiar with the writing workflow.',
    sourceUrl: '',
    coverPath: '',
    showCover: true,
    openComment: false,
    fansOnlyComment: false,
    contentMarkdown:
      '## Start writing\n\nThis is your writing desk for WeChat Official Account articles.\n\n- Manage drafts in the left drawer\n- Write in Markdown on the paper-style sheet\n- Use preview, the AI assistant, and publishing tools in the right panel\n\nWhen an article is ready, upload it to the WeChat draft box first, review it manually, then publish.',
    chat: [],
    wechat: {
      draftMediaId: '',
      publishId: '',
      articleId: '',
      articleUrl: '',
      lastStatus: ''
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function defaultData() {
  return {
    version: DATA_VERSION,
    settings: {
      openaiModel: DEFAULT_MODEL,
      openaiBaseUrl: '',
      openaiApiKey: '',
      wechatAppId: '',
      wechatAppSecret: ''
    },
    articles: [defaultArticle()]
  };
}

function ensureDirs() {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Translates auto-generated Chinese seed content from pre-0.4 data files.
// Only touches text the app itself wrote — never user-authored content.
function migrateSeedContent(article) {
  const next = { ...article };
  if (next.title === '未命名文章') {
    next.title = 'Untitled';
  }
  const isOldStarter =
    next.title === '第一篇公众号文章' &&
    (next.contentMarkdown || '').includes('这里是你的公众号写作台');
  if (isOldStarter) {
    const starter = defaultArticle(next.createdAt);
    next.title = starter.title;
    next.digest = starter.digest;
    next.contentMarkdown = starter.contentMarkdown;
  }
  return next;
}

function normalizeArticle(article) {
  return {
    ...defaultArticle(article.createdAt || nowIso()),
    ...migrateSeedContent(article),
    chat: Array.isArray(article.chat) ? article.chat : [],
    wechat: {
      draftMediaId: '',
      publishId: '',
      articleId: '',
      articleUrl: '',
      lastStatus: '',
      ...(article.wechat || {})
    }
  };
}

function readData() {
  ensureDirs();

  let raw;
  try {
    raw = fs.readFileSync(dataPath, 'utf8');
  } catch {
    // First run (or file missing) — initialize a fresh store.
    const fresh = defaultData();
    writeData(fresh);
    return fresh;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The file exists but is corrupted. Never overwrite it silently: keep the
    // damaged file next to data.json so the user can recover from it.
    const backupPath = `${dataPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      fs.renameSync(dataPath, backupPath);
      console.error(`data.json is corrupted; moved it to ${backupPath} and reinitialized.`);
    } catch (renameError) {
      console.error(`data.json is corrupted and could not be backed up: ${renameError.message}`);
    }
    const fresh = defaultData();
    writeData(fresh);
    return fresh;
  }

  const data = {
    version: DATA_VERSION,
    settings: {
      openaiModel: DEFAULT_MODEL,
      openaiBaseUrl: '',
      openaiApiKey: '',
      wechatAppId: '',
      wechatAppSecret: '',
      ...(parsed.settings || {})
    },
    articles: (Array.isArray(parsed.articles) ? parsed.articles : []).map(normalizeArticle)
  };

  // v1 (Electron) stored secrets as { encrypted, value } records; keep only plain values.
  for (const key of ['openaiApiKey', 'wechatAppSecret']) {
    const record = data.settings[key];
    if (record && typeof record === 'object') {
      data.settings[key] = record.encrypted ? '' : record.value || '';
    }
  }

  return data;
}

function writeData(data) {
  ensureDirs();
  // Write to a temp file and rename so a crash mid-write can never leave a
  // truncated data.json behind (rename on the same filesystem is atomic).
  const tmpPath = `${dataPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, dataPath);
}

function getPrivateSettings() {
  const { settings } = readData();
  return {
    openaiModel: settings.openaiModel || DEFAULT_MODEL,
    openaiBaseUrl: settings.openaiBaseUrl || process.env.OPENAI_BASE_URL || '',
    openaiApiKey: settings.openaiApiKey || process.env.OPENAI_API_KEY || '',
    wechatAppId: settings.wechatAppId || process.env.WECHAT_APPID || '',
    wechatAppSecret: settings.wechatAppSecret || process.env.WECHAT_APPSECRET || ''
  };
}

function getPublicSettings() {
  const settings = getPrivateSettings();
  return {
    openaiModel: settings.openaiModel,
    openaiBaseUrl: settings.openaiBaseUrl,
    hasOpenaiApiKey: Boolean(settings.openaiApiKey),
    wechatAppId: settings.wechatAppId,
    hasWechatAppSecret: Boolean(settings.wechatAppSecret)
  };
}

function saveSettings(payload = {}) {
  const data = readData();
  if (Object.hasOwn(payload, 'openaiModel')) {
    data.settings.openaiModel = payload.openaiModel || DEFAULT_MODEL;
  }
  if (Object.hasOwn(payload, 'openaiBaseUrl')) {
    data.settings.openaiBaseUrl = (payload.openaiBaseUrl || '').trim().replace(/\/+$/, '');
  }
  if (Object.hasOwn(payload, 'wechatAppId')) {
    data.settings.wechatAppId = (payload.wechatAppId || '').trim();
  }
  if (payload.openaiApiKey) {
    data.settings.openaiApiKey = payload.openaiApiKey.trim();
  }
  if (payload.wechatAppSecret) {
    data.settings.wechatAppSecret = payload.wechatAppSecret.trim();
  }
  writeData(data);
  return getPublicSettings();
}

function listArticles() {
  return readData().articles;
}

function getArticle(articleId) {
  return readData().articles.find((item) => item.id === articleId) || null;
}

function createArticle() {
  const data = readData();
  const article = normalizeArticle({
    id: createId('article'),
    title: 'Untitled',
    digest: '',
    contentMarkdown: ''
  });
  data.articles.unshift(article);
  writeData(data);
  return article;
}

function upsertArticle(article) {
  const data = readData();
  const index = data.articles.findIndex((item) => item.id === article.id);
  const merged = {
    ...(index >= 0 ? data.articles[index] : {}),
    ...article,
    updatedAt: nowIso()
  };
  const next = normalizeArticle({ ...merged, title: merged.title || 'Untitled' });
  if (index >= 0) {
    data.articles[index] = next;
  } else {
    data.articles.unshift(next);
  }
  writeData(data);
  return next;
}

function deleteArticle(articleId) {
  const data = readData();
  data.articles = data.articles.filter((item) => item.id !== articleId);
  writeData(data);
  return data.articles;
}

function saveUpload(originalName, buffer) {
  ensureDirs();
  const ext = (path.extname(originalName || '') || '.bin').toLowerCase();
  const fileName = `${createId('upload')}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
  return `/uploads/${fileName}`;
}

function resolveUpload(urlPath = '') {
  if (!urlPath.startsWith('/uploads/')) return null;
  const fileName = path.basename(urlPath);
  const filePath = path.join(uploadsDir, fileName);
  return fs.existsSync(filePath) ? filePath : null;
}

module.exports = {
  DEFAULT_MODEL,
  dataDir,
  uploadsDir,
  dataPath,
  createId,
  readData,
  getPrivateSettings,
  getPublicSettings,
  saveSettings,
  listArticles,
  getArticle,
  createArticle,
  upsertArticle,
  deleteArticle,
  saveUpload,
  resolveUpload
};
