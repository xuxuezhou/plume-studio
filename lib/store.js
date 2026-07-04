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
    title: '第一篇公众号文章',
    author: '',
    digest: '用这篇起始草稿熟悉本地写作流程。',
    sourceUrl: '',
    coverPath: '',
    showCover: true,
    openComment: false,
    fansOnlyComment: false,
    contentMarkdown:
      '## 开始写作\n\n这里是你的公众号写作台，现在是网页版。\n\n- 左侧抽屉管理草稿\n- 中间纸张区专注写作，支持 Markdown\n- 右侧面板提供预览、AI 助手和发布工具\n\n文章准备好后，先上传到公众号草稿箱，人工检查无误后再正式发布。',
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

function normalizeArticle(article) {
  return {
    ...defaultArticle(article.createdAt || nowIso()),
    ...article,
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
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch {
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
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), { mode: 0o600 });
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
    title: '未命名文章',
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
  const next = normalizeArticle({ ...merged, title: merged.title || '未命名文章' });
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
