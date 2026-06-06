const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { DEFAULT_MODEL, runWritingAssistant } = require('./services/openaiClient');
const { createDraft, getPublishStatus, submitPublish, testConnection } = require('./services/wechatClient');

const DATA_VERSION = 1;

let mainWindow;
let dataPath;
let rendererRecoveryReloaded = false;

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
    articles: [defaultArticle(timestamp)]
  };
}

function defaultArticle(timestamp = nowIso()) {
  const createdAt = timestamp;
  return {
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
      '## Start writing\n\nThis is your local WeChat Official Account writing desk.\n\n- Manage articles in the draft drawer\n- Write in the left paper-style editor\n- Use preview, AI, publishing, and settings from the right panel\n\nWhen the article is ready, send it to the WeChat draft box first, then publish only after a final manual check.',
    wechat: {
      draftMediaId: '',
      publishId: '',
      articleId: '',
      lastStatus: ''
    },
    createdAt,
    updatedAt: createdAt
  };
}

function migrateData(data) {
  let changed = false;
  const next = {
    version: DATA_VERSION,
    settings: {
      openaiModel: DEFAULT_MODEL,
      openaiApiKey: null,
      wechatAppId: '',
      wechatAppSecret: null,
      ...(data.settings || {})
    },
    articles: Array.isArray(data.articles) ? data.articles : []
  };

  if (next.articles.length === 0) {
    next.articles = [defaultArticle()];
    changed = true;
  }

  next.articles = next.articles.map((article) => {
    const looksLikeOldStarter =
      article.title === '\u7b2c\u4e00\u7bc7\u516c\u4f17\u53f7\u6587\u7ae0' ||
      article.contentMarkdown?.includes('\u8fd9\u91cc\u662f\u4f60\u7684\u672c\u5730\u516c\u4f17\u53f7\u5199\u4f5c\u53f0');

    if (!looksLikeOldStarter) {
      return article;
    }

    changed = true;
    return {
      ...defaultArticle(article.createdAt || nowIso()),
      id: article.id || createId('article'),
      wechat: {
        draftMediaId: '',
        publishId: '',
        articleId: '',
        lastStatus: '',
        ...(article.wechat || {})
      }
    };
  });

  return { data: next, changed };
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
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const migrated = migrateData(parsed);
    if (migrated.changed) {
      writeData(migrated.data);
    }
    return migrated.data;
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
  rendererRecoveryReloaded = false;
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

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(ensureRendererLoaded, 80);
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: {
      v: app.getVersion()
    }
  });
}

async function ensureRendererLoaded() {
  const rendererPath = path.join(__dirname, 'renderer');
  const state = await getRendererLoadState();

  if (state.sourceLeak) {
    await cleanupRendererSourceLeak();
  }

  if ((!state.styleCount || !state.scriptStarted) && !rendererRecoveryReloaded) {
    rendererRecoveryReloaded = true;
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(ensureRendererLoaded, 80);
    });
    mainWindow.webContents.reloadIgnoringCache();
    return;
  }

  if (!state.styleCount) {
    const css = fs.readFileSync(path.join(rendererPath, 'styles.css'), 'utf8');
    await mainWindow.webContents.insertCSS(css);
  }

  if (!state.scriptStarted) {
    const js = fs.readFileSync(path.join(rendererPath, 'app.js'), 'utf8');
    await injectRendererScript(js);
    await cleanupRendererSourceLeak();
  }
}

function getRendererLoadState() {
  return mainWindow.webContents
    .executeJavaScript(
      `(() => {
        const sourceLeak = [...document.body.childNodes].some((node) => {
          if (node.nodeType !== Node.TEXT_NODE) return false;
          return /document\\.querySelector\\('#createDraftButton'\\)|window\\.__WEWRITE_READY|setWechatLog\\(response\\.result\\)/.test(node.textContent || '');
        });
        return {
          styleCount: document.styleSheets.length,
          scriptStarted: Boolean(window.__WEWRITE_SCRIPT_STARTED),
          scriptReady: Boolean(window.__WEWRITE_READY),
          sourceLeak
        };
      })()`
    )
    .catch(() => ({ styleCount: 0, scriptStarted: false, scriptReady: false, sourceLeak: false }));
}

function cleanupRendererSourceLeak() {
  return mainWindow.webContents
    .executeJavaScript(
      `(() => {
        const leakedSourcePattern = /document\\.querySelector\\('#createDraftButton'\\)|window\\.__WEWRITE_READY|setWechatLog\\(response\\.result\\)/;
        for (const node of [...document.body.childNodes]) {
          if (node.nodeType === Node.TEXT_NODE && leakedSourcePattern.test(node.textContent || '')) {
            node.remove();
          }
        }
      })()`
    )
    .catch(() => {});
}

function injectRendererScript(js) {
  const scriptSource = `${js}\n//# sourceURL=wewrite-fallback-app.js`;
  return mainWindow.webContents.executeJavaScript(
    `(() => {
      if (window.__WEWRITE_SCRIPT_STARTED) return true;
      const script = document.createElement('script');
      script.dataset.wewriteFallback = 'true';
      script.textContent = ${JSON.stringify(scriptSource)};
      document.head.appendChild(script);
      script.remove();
      return Boolean(window.__WEWRITE_SCRIPT_STARTED);
    })()`
  );
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
  if (Object.hasOwn(payload, 'openaiModel')) {
    data.settings.openaiModel = payload.openaiModel || DEFAULT_MODEL;
  }
  if (Object.hasOwn(payload, 'wechatAppId')) {
    data.settings.wechatAppId = payload.wechatAppId || '';
  }

  if (payload.openaiApiKey) {
    data.settings.openaiApiKey = encodeSecret(payload.openaiApiKey);
  }
  if (payload.wechatAppSecret) {
    data.settings.wechatAppSecret = encodeSecret(payload.wechatAppSecret);
  }

  writeData(data);
  return getPublicSettings();
});

ipcMain.handle('account:openChatGpt', async () => {
  await shell.openExternal('https://chatgpt.com/auth/login');
  return true;
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
