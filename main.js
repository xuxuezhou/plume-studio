const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const { DEFAULT_MODEL, runWritingAssistant } = require('./services/openaiClient');
const { createDraft, getPublishStatus, submitPublish, testConnection } = require('./services/wechatClient');

const DATA_VERSION = 1;

let mainWindow;
let dataPath;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultData() {
  const timestamp = nowIso();
  return {
    version: DATA_VERSION,
    settings: {
      openaiModel: DEFAULT_MODEL,
      openaiApiKey: null,
      wechatAppId: '',
      wechatAppSecret: null
    },
    articles: [
      {
        id: createId('article'),
        title: 'First WeChat Article',
        author: '',
        digest: 'Use this starter draft to shape your local writing workflow.',
        sourceUrl: '',
        coverPath: '',
        showCover: true,
        openComment: false,
        fansOnlyComment: false,
        contentMarkdown:
          '## Start writing\n\nThis is your local WeChat Official Account writing desk.\n\n- Manage articles in the library\n- Draft in the center editor\n- Ask GPT for editing help in the side panel\n\nWhen the article is ready, send it to the WeChat draft box first, then publish only after a final manual check.',
        wechat: {
          draftMediaId: '',
          publishId: '',
          articleId: '',
          lastStatus: ''
        },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };
}

function ensureDataFile() {
  const dir = app.getPath('userData');
  dataPath = path.join(dir, 'data.json');
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dataPath, JSON.stringify(defaultData(), null, 2));
  }
}

function readData() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch {
    const fresh = defaultData();
    writeData(fresh);
    return fresh;
  }
}

function writeData(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function encodeSecret(value) {
  if (!value) return null;
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encrypted: true,
      value: safeStorage.encryptString(value).toString('base64')
    };
  }
  return {
    encrypted: false,
    value
  };
}

function decodeSecret(record) {
  if (!record) return '';
  if (typeof record === 'string') return record;
  if (!record.encrypted) return record.value || '';
  try {
    return safeStorage.decryptString(Buffer.from(record.value, 'base64'));
  } catch {
    return '';
  }
}

function getPrivateSettings() {
  const data = readData();
  return {
    openaiModel: data.settings.openaiModel || DEFAULT_MODEL,
    openaiApiKey: decodeSecret(data.settings.openaiApiKey) || process.env.OPENAI_API_KEY || '',
    wechatAppId: data.settings.wechatAppId || '',
    wechatAppSecret: decodeSecret(data.settings.wechatAppSecret)
  };
}

function getPublicSettings() {
  const settings = getPrivateSettings();
  return {
    openaiModel: settings.openaiModel,
    hasOpenaiApiKey: Boolean(settings.openaiApiKey),
    wechatAppId: settings.wechatAppId,
    hasWechatAppSecret: Boolean(settings.wechatAppSecret)
  };
}

function sanitizeData(data) {
  return {
    articles: data.articles || [],
    settings: getPublicSettings(),
    dataPath
  };
}

function upsertArticle(article) {
  const data = readData();
  const index = data.articles.findIndex((item) => item.id === article.id);
  const timestamp = nowIso();
  const nextArticle = {
    ...article,
    title: article.title || 'Untitled Article',
    updatedAt: timestamp,
    createdAt: article.createdAt || timestamp,
    wechat: {
      draftMediaId: '',
      publishId: '',
      articleId: '',
      lastStatus: '',
      ...(article.wechat || {})
    }
  };

  if (index >= 0) {
    data.articles[index] = nextArticle;
  } else {
    data.articles.unshift(nextArticle);
  }

  writeData(data);
  return nextArticle;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: 'WeWrite Studio',
    backgroundColor: '#f6f3ee',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ensureDataFile();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('data:load', () => sanitizeData(readData()));

ipcMain.handle('articles:create', () => {
  const timestamp = nowIso();
  const article = {
    id: createId('article'),
    title: 'Untitled Article',
    author: '',
    digest: '',
    sourceUrl: '',
    coverPath: '',
    showCover: true,
    openComment: false,
    fansOnlyComment: false,
    contentMarkdown: '',
    wechat: {
      draftMediaId: '',
      publishId: '',
      articleId: '',
      lastStatus: ''
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return upsertArticle(article);
});

ipcMain.handle('articles:save', (_event, article) => upsertArticle(article));

ipcMain.handle('articles:delete', (_event, articleId) => {
  const data = readData();
  data.articles = data.articles.filter((item) => item.id !== articleId);
  writeData(data);
  return sanitizeData(data);
});

ipcMain.handle('settings:save', (_event, payload) => {
  const data = readData();
  data.settings.openaiModel = payload.openaiModel || DEFAULT_MODEL;
  data.settings.wechatAppId = payload.wechatAppId || '';

  if (payload.openaiApiKey) {
    data.settings.openaiApiKey = encodeSecret(payload.openaiApiKey);
  }
  if (payload.wechatAppSecret) {
    data.settings.wechatAppSecret = encodeSecret(payload.wechatAppSecret);
  }

  writeData(data);
  return getPublicSettings();
});

ipcMain.handle('dialog:chooseImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Cover Image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  });
  return result.canceled ? '' : result.filePaths[0];
});

ipcMain.handle('assistant:run', async (_event, payload) => {
  const settings = getPrivateSettings();
  return runWritingAssistant({
    apiKey: settings.openaiApiKey,
    model: settings.openaiModel,
    action: payload.action,
    article: payload.article,
    selection: payload.selection,
    note: payload.note
  });
});

ipcMain.handle('wechat:test', async () => testConnection(getPrivateSettings()));

ipcMain.handle('wechat:createDraft', async (_event, payload) => {
  const data = readData();
  const article = data.articles.find((item) => item.id === payload.article.id) || payload.article;
  const mergedArticle = {
    ...article,
    ...payload.article
  };
  const result = await createDraft(getPrivateSettings(), mergedArticle, payload.htmlContent);
  const saved = upsertArticle({
    ...mergedArticle,
    wechat: {
      ...(mergedArticle.wechat || {}),
      draftMediaId: result.mediaId,
      coverMediaId: result.coverMediaId,
      coverUrl: result.coverUrl,
      lastStatus: 'Draft created'
    }
  });
  return { result, article: saved };
});

ipcMain.handle('wechat:publish', async (_event, payload) => {
  const result = await submitPublish(getPrivateSettings(), payload.mediaId);
  const data = readData();
  const article = data.articles.find((item) => item.id === payload.articleId);
  if (article) {
    upsertArticle({
      ...article,
      wechat: {
        ...(article.wechat || {}),
        publishId: result.publishId,
        lastStatus: 'Publish submitted'
      }
    });
  }
  return result;
});

ipcMain.handle('wechat:status', async (_event, payload) => {
  const result = await getPublishStatus(getPrivateSettings(), payload.publishId);
  const data = readData();
  const article = data.articles.find((item) => item.id === payload.articleId);
  if (article) {
    upsertArticle({
      ...article,
      wechat: {
        ...(article.wechat || {}),
        articleId: result.article_id || article.wechat?.articleId || '',
        lastStatus: JSON.stringify(result)
      }
    });
  }
  return result;
});
