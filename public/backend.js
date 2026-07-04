/* Backend abstraction.
 *
 * Plume Studio runs in two modes with the same UI:
 *  - "server":  self-hosted Express server — articles on disk, AI proxied
 *               server-side, full WeChat publishing.
 *  - "browser": static hosting (e.g. the public Vercel site) — articles in
 *               localStorage, AI called directly from the browser with the
 *               visitor's own API key, WeChat publishing unavailable.
 */

const PLUME_STORAGE_KEY = 'plume-data';
const PLUME_DEFAULT_MODEL = 'gpt-5.4-mini';
const PLUME_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

async function createBackend() {
  try {
    const response = await fetch('/api/data');
    if (response.ok && (response.headers.get('content-type') || '').includes('json')) {
      return createServerBackend(await response.json());
    }
  } catch {
    // Static hosting or server unreachable — fall through to browser mode.
  }
  return createBrowserBackend();
}

// ---------- shared helpers ----------

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: HTTP ${response.status}`);
  }
  return payload;
}

// Reads an OpenAI-style SSE body ("data: {...choices[0].delta.content}") and
// also accepts this app's own event framing ("event: delta\ndata: {text}").
async function consumeSseStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let errorMessage = '';

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (parsed.message && !parsed.text && !parsed.choices) {
      errorMessage = parsed.message;
      return;
    }
    const delta = parsed.text ?? parsed.choices?.[0]?.delta?.content ?? '';
    // The server's final "done" event repeats the full text; skip it.
    if (delta && delta !== fullText) {
      fullText += delta;
      onDelta?.(delta);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(handleLine);
  }
  if (buffer.trim()) handleLine(buffer);

  if (errorMessage) throw new Error(errorMessage);
  if (!fullText.trim()) throw new Error('The AI returned an empty response.');
  return fullText;
}

// ---------- server mode ----------

function createServerBackend(initialData) {
  return {
    mode: 'server',
    initialData,

    getData: () => fetch('/api/data').then(parseJsonResponse),

    createArticle: () => fetch('/api/articles', { method: 'POST' }).then(parseJsonResponse),

    updateArticle: (id, payload) =>
      fetch(`/api/articles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(parseJsonResponse),

    deleteArticle: (id) =>
      fetch(`/api/articles/${id}`, { method: 'DELETE' }).then(parseJsonResponse),

    saveSettings: (payload) =>
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(parseJsonResponse),

    uploadImage: async (file) => {
      const response = await fetch(
        `/api/upload?filename=${encodeURIComponent(file.name || 'image.jpg')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file
        }
      );
      return (await parseJsonResponse(response)).url;
    },

    assistantStream: async (payload, onDelta) => {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: HTTP ${response.status}`);
      }
      return consumeSseStream(response, onDelta);
    },

    assistantTest: (model) =>
      fetch('/api/assistant/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      }).then(parseJsonResponse),

    wechatTest: () => fetch('/api/wechat/test', { method: 'POST' }).then(parseJsonResponse),

    wechatDraft: (articleId) =>
      fetch('/api/wechat/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId })
      }).then(parseJsonResponse),

    wechatPublish: (articleId) =>
      fetch('/api/wechat/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId })
      }).then(parseJsonResponse),

    wechatStatus: (articleId) => fetch(`/api/wechat/status/${articleId}`).then(parseJsonResponse)
  };
}

// ---------- browser mode ----------

function createBrowserBackend() {
  const createId = (prefix) =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const defaultArticle = () => {
    const timestamp = new Date().toISOString();
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
        "## Start writing\n\nWelcome to Plume Studio. Everything you write here stays **in your browser** — nothing is sent to any server.\n\n- Manage drafts in the left drawer\n- Write in Markdown on the paper-style sheet\n- Open **Settings** and add your own OpenAI-compatible API key to enable the AI assistant\n\nWeChat publishing needs a fixed server IP, so it's available in the [self-hosted version](https://github.com/xuxuezhou/wechat-writing-studio).",
      chat: [],
      wechat: { draftMediaId: '', publishId: '', articleId: '', articleUrl: '', lastStatus: '' },
      createdAt: timestamp,
      updatedAt: timestamp
    };
  };

  function readStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PLUME_STORAGE_KEY) || 'null');
      if (parsed && Array.isArray(parsed.articles)) return parsed;
    } catch {
      // Corrupted store — start fresh.
    }
    const fresh = {
      articles: [defaultArticle()],
      settings: { openaiModel: PLUME_DEFAULT_MODEL, openaiBaseUrl: '', openaiApiKey: '' }
    };
    writeStore(fresh);
    return fresh;
  }

  function writeStore(data) {
    localStorage.setItem(PLUME_STORAGE_KEY, JSON.stringify(data));
  }

  function publicSettings(settings) {
    return {
      openaiModel: settings.openaiModel || PLUME_DEFAULT_MODEL,
      openaiBaseUrl: settings.openaiBaseUrl || '',
      hasOpenaiApiKey: Boolean(settings.openaiApiKey),
      wechatAppId: '',
      hasWechatAppSecret: false
    };
  }

  const wechatUnavailable = () => {
    throw new Error(
      'WeChat publishing is not available on the public site: the WeChat API requires a fixed, allowlisted server IP. Run the self-hosted version instead — see the GitHub repository linked in Settings.'
    );
  };

  const MAX_HISTORY_MESSAGES = 20;

  function buildMessages({ article, selection, note, action, history, attachments }) {
    const ACTION_INSTRUCTIONS = {
      outline:
        'Design a clear, compelling structure for this article: title directions, the core argument, section flow, and a strong ending.',
      titles:
        'Generate 12 title options for this article, grouped into restrained, opinion-led, story-led, and share-friendly styles. Avoid low-quality clickbait.',
      rewrite:
        'Rewrite the draft so it is clearer, tighter, and better paced for mobile reading. Preserve facts and the author stance; do not add unsupported claims. Output the full rewritten text directly.',
      summary:
        'Write a concise article digest (under 120 characters). Keep it direct, specific, and appealing without sounding overly promotional.',
      review:
        'Review like a senior editor: point out issues in structure, logic, factual wording, redundancy, title, digest, ending, and platform risk, and give actionable fixes.'
    };

    const systemParts = [
      'You are a careful writing editor helping the user polish the current draft.',
      'Reply in the same language as the draft unless the user asks otherwise. Keep the output directly usable, stay factual, and never invent sources.',
      '',
      `Article title: ${article?.title || 'Untitled'}`,
      `Author: ${article?.author || 'Not provided'}`,
      `Digest: ${article?.digest || 'Not provided'}`,
      '',
      'Current draft:',
      article?.contentMarkdown?.trim()
        ? article.contentMarkdown.slice(0, 24000)
        : '(The draft is empty. Work from the title and digest.)'
    ];
    if (selection?.trim()) {
      systemParts.push(
        '',
        'Text the user currently has selected (focus on this if they ask for edits):',
        selection.slice(0, 8000)
      );
    }

    const messages = [{ role: 'system', content: systemParts.join('\n') }];
    for (const message of (history || []).slice(-MAX_HISTORY_MESSAGES)) {
      if ((message.role === 'user' || message.role === 'assistant') && message.content) {
        messages.push({ role: message.role, content: String(message.content).slice(0, 12000) });
      }
    }

    const attachmentContext = (attachments || [])
      .filter((attachment) => attachment.content)
      .slice(0, 8)
      .map((attachment) => `File: ${attachment.name}\nContent:\n${attachment.content.slice(0, 6000)}`)
      .join('\n\n---\n\n');

    messages.push({
      role: 'user',
      content:
        [
          ACTION_INSTRUCTIONS[action] ? `Task: ${ACTION_INSTRUCTIONS[action]}` : '',
          note || '',
          attachmentContext ? `\nReference material:\n${attachmentContext}` : ''
        ]
          .filter(Boolean)
          .join('\n\n') || 'Give the most helpful writing advice for the current draft.'
    });

    return messages;
  }

  async function callOpenAI({ model, messages, stream }) {
    const { settings } = readStore();
    if (!settings.openaiApiKey) {
      throw new Error('Add your OpenAI-compatible API key in Settings first. It is stored only in this browser.');
    }
    const baseUrl = (settings.openaiBaseUrl || PLUME_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || settings.openaiModel || PLUME_DEFAULT_MODEL,
        messages,
        stream: Boolean(stream)
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || `AI request failed: HTTP ${response.status}`);
    }
    return response;
  }

  return {
    mode: 'browser',
    initialData: null,

    getData: async () => {
      const data = readStore();
      return {
        articles: data.articles,
        settings: publicSettings(data.settings),
        dataPath: 'Stored in this browser (localStorage)'
      };
    },

    createArticle: async () => {
      const data = readStore();
      const article = { ...defaultArticle(), title: 'Untitled', digest: '', contentMarkdown: '' };
      data.articles.unshift(article);
      writeStore(data);
      return article;
    },

    updateArticle: async (id, payload) => {
      const data = readStore();
      const index = data.articles.findIndex((item) => item.id === id);
      const base = index >= 0 ? data.articles[index] : defaultArticle();
      const merged = { ...base, ...payload, id, updatedAt: new Date().toISOString() };
      merged.title = merged.title || 'Untitled';
      if (index >= 0) {
        data.articles[index] = merged;
      } else {
        data.articles.unshift(merged);
      }
      writeStore(data);
      return merged;
    },

    deleteArticle: async (id) => {
      const data = readStore();
      data.articles = data.articles.filter((item) => item.id !== id);
      writeStore(data);
      return { articles: data.articles };
    },

    saveSettings: async (payload) => {
      const data = readStore();
      if (Object.hasOwn(payload, 'openaiModel')) {
        data.settings.openaiModel = payload.openaiModel || PLUME_DEFAULT_MODEL;
      }
      if (Object.hasOwn(payload, 'openaiBaseUrl')) {
        data.settings.openaiBaseUrl = (payload.openaiBaseUrl || '').trim().replace(/\/+$/, '');
      }
      if (payload.openaiApiKey) {
        data.settings.openaiApiKey = payload.openaiApiKey.trim();
      }
      writeStore(data);
      return publicSettings(data.settings);
    },

    uploadImage: (file) =>
      new Promise((resolve, reject) => {
        if (file.size > 2_000_000) {
          reject(new Error('Images over 2 MB are not supported in browser mode (they are stored inline).'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the image file.'));
        reader.readAsDataURL(file);
      }),

    assistantStream: async (payload, onDelta) => {
      const messages = buildMessages(payload);
      const response = await callOpenAI({ model: payload.model, messages, stream: true });
      return consumeSseStream(response, onDelta);
    },

    assistantTest: async (model) => {
      const response = await callOpenAI({
        model,
        messages: [{ role: 'user', content: "Reply with the single word 'ok'." }],
        stream: false
      });
      const payload = await response.json();
      return { ok: true, model: payload.model || model || PLUME_DEFAULT_MODEL };
    },

    wechatTest: wechatUnavailable,
    wechatDraft: wechatUnavailable,
    wechatPublish: wechatUnavailable,
    wechatStatus: wechatUnavailable
  };
}
