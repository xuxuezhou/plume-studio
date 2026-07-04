const path = require('node:path');
const express = require('express');

const store = require('./lib/store');
const markdown = require('./public/shared/markdown');
const openai = require('./services/openaiClient');
const wechat = require('./services/wechatClient');

const app = express();
const PORT = Number(process.env.PORT || 5757);
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(store.uploadsDir));

function handleError(res, error) {
  res.status(400).json({ error: error.message || String(error) });
}

// ---------- data ----------

app.get('/api/data', (_req, res) => {
  res.json({
    articles: store.listArticles(),
    settings: store.getPublicSettings(),
    dataPath: store.dataPath
  });
});

app.post('/api/articles', (_req, res) => {
  res.json(store.createArticle());
});

app.put('/api/articles/:id', (req, res) => {
  try {
    res.json(store.upsertArticle({ ...req.body, id: req.params.id }));
  } catch (error) {
    handleError(res, error);
  }
});

app.delete('/api/articles/:id', (req, res) => {
  res.json({ articles: store.deleteArticle(req.params.id) });
});

app.post('/api/settings', (req, res) => {
  try {
    res.json(store.saveSettings(req.body || {}));
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- uploads (raw body, filename via query) ----------

app.post(
  '/api/upload',
  express.raw({ type: () => true, limit: '12mb' }),
  (req, res) => {
    try {
      if (!req.body || !req.body.length) {
        throw new Error('No file content received.');
      }
      const name = String(req.query.filename || 'image.jpg');
      if (!/\.(jpe?g|png|webp|gif)$/i.test(name)) {
        throw new Error('Only jpg / png / webp / gif images are supported.');
      }
      res.json({ url: store.saveUpload(name, req.body) });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// ---------- AI assistant (SSE streaming) ----------

app.post('/api/assistant', async (req, res) => {
  const settings = store.getPrivateSettings();
  const { article, selection, note, action, history, attachments, model } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const text = await openai.streamAssistant(
      {
        apiKey: settings.openaiApiKey,
        baseUrl: settings.openaiBaseUrl,
        model: model || settings.openaiModel,
        article,
        selection,
        note,
        action,
        history,
        attachments
      },
      (delta) => send('delta', { text: delta })
    );
    send('done', { text });
  } catch (error) {
    send('error', { message: error.message || String(error) });
  } finally {
    res.end();
  }
});

app.post('/api/assistant/test', async (req, res) => {
  const settings = store.getPrivateSettings();
  try {
    res.json(
      await openai.testConnection({
        apiKey: settings.openaiApiKey,
        baseUrl: settings.openaiBaseUrl,
        model: req.body?.model || settings.openaiModel
      })
    );
  } catch (error) {
    handleError(res, error);
  }
});

// ---------- WeChat publishing ----------

app.post('/api/wechat/test', async (_req, res) => {
  try {
    res.json(await wechat.testConnection(store.getPrivateSettings()));
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/wechat/draft', async (req, res) => {
  try {
    const article = store.getArticle(req.body?.articleId);
    if (!article) {
      throw new Error('Article not found. Save it first.');
    }

    const htmlContent = markdown.toWechatHtml(article.contentMarkdown || '');
    const result = await wechat.createDraft(
      store.getPrivateSettings(),
      article,
      htmlContent,
      store.resolveUpload
    );

    const saved = store.upsertArticle({
      ...article,
      wechat: {
        ...article.wechat,
        draftMediaId: result.mediaId,
        publishId: '',
        articleId: '',
        articleUrl: '',
        lastStatus: 'Uploaded to draft box'
      }
    });

    res.json({ result, article: saved });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/wechat/publish', async (req, res) => {
  try {
    const article = store.getArticle(req.body?.articleId);
    if (!article) {
      throw new Error('Article not found. Save it first.');
    }

    const result = await wechat.publishDraft(store.getPrivateSettings(), article.wechat?.draftMediaId);
    const saved = store.upsertArticle({
      ...article,
      wechat: {
        ...article.wechat,
        publishId: result.publishId,
        lastStatus: 'Submitted for publishing, under review'
      }
    });

    res.json({ result, article: saved });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/wechat/status/:articleId', async (req, res) => {
  try {
    const article = store.getArticle(req.params.articleId);
    if (!article) {
      throw new Error('Article not found.');
    }

    const status = await wechat.getPublishStatus(store.getPrivateSettings(), article.wechat?.publishId);
    const saved = store.upsertArticle({
      ...article,
      wechat: {
        ...article.wechat,
        articleId: status.articleId || article.wechat.articleId,
        articleUrl: status.articleUrl || article.wechat.articleUrl,
        lastStatus: status.statusText
      }
    });

    res.json({ status, article: saved });
  } catch (error) {
    handleError(res, error);
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Plume Studio running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Data directory: ${store.dataDir}`);
});
