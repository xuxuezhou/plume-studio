/* global WeWriteMarkdown, createBackend */
const { escapeHtml, markdownToHtml } = WeWriteMarkdown;

const MODEL_OPTIONS = ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5'];
const ACTION_PROMPTS = {
  outline: 'Draft a structural outline for this article.',
  titles: 'Generate a batch of title options.',
  rewrite: 'Rewrite the current draft (or just my selection if I have one).',
  summary: 'Write a digest for this article.',
  review: 'Review this draft like a senior editor.'
};
const MAX_ATTACHMENT_BYTES = 120_000;

const DEFAULT_LAYOUT = {
  theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  drawerWidth: 224,
  inspectorWidth: 420,
  draftsHidden: false,
  inspectorHidden: false
};

let backend = null;

const state = {
  articles: [],
  settings: {},
  layout: loadLayout(),
  activeId: '',
  searchTerm: '',
  assistantAttachments: [],
  streaming: false,
  saving: false,
  dirty: false
};

const elements = {};
[
  'articleList', 'dataPath', 'searchInput', 'draftCount',
  'titleInput', 'authorInput', 'contentInput', 'wordCount', 'saveState',
  'digestInput', 'sourceUrlInput', 'showCoverInput', 'openCommentInput', 'fansOnlyCommentInput',
  'coverUploader', 'coverPreview', 'coverPlaceholder', 'coverFileInput',
  'preview', 'saveButton', 'deleteButton', 'newArticleButton', 'insertImageButton', 'editorImageInput',
  'toggleDraftsButton', 'jumpAssistantButton', 'toggleInspectorButton', 'themeButton',
  'draftResizeHandle', 'inspectorResizeHandle',
  'assistantChat', 'assistantEmpty', 'assistantAttachments', 'assistantNote', 'assistantModelSelect',
  'assistantAttachButton', 'assistantSendButton', 'assistantFileInput', 'assistantActions', 'clearChatButton',
  'wechatLog', 'publishStatus', 'createDraftButton', 'publishButton', 'statusButton', 'publishCloudNote',
  'openaiApiKeyInput', 'openaiBaseUrlInput', 'openaiModelInput', 'aiSettingsNote',
  'wechatAppIdInput', 'wechatAppSecretInput', 'wechatSettingsSection',
  'testOpenaiButton', 'testWechatButton',
  'settingsState', 'resetLayoutButton', 'settingsModal', 'openSettingsButton', 'closeSettingsButton',
  'saveSettingsButton'
].forEach((id) => {
  elements[id] = document.querySelector(`#${id}`);
});

const isBrowserMode = () => backend?.mode === 'browser';

// ---------- layout ----------

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadLayout() {
  try {
    const stored = JSON.parse(localStorage.getItem('plume-layout') || localStorage.getItem('wewrite-layout') || '{}');
    const drawerWidth = clamp(stored.drawerWidth || DEFAULT_LAYOUT.drawerWidth, 190, 360);
    const maxInspectorWidth = clamp(window.innerWidth - 76 - drawerWidth - 12 - 460, 360, 680);
    return {
      ...DEFAULT_LAYOUT,
      ...stored,
      drawerWidth,
      inspectorWidth: clamp(stored.inspectorWidth || DEFAULT_LAYOUT.inspectorWidth, 360, maxInspectorWidth)
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function saveLayout() {
  localStorage.setItem('plume-layout', JSON.stringify(state.layout));
}

function setButtonLabel(button, label) {
  button.title = label;
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = label;
}

function syncRailState() {
  const activeTab = document.querySelector('.tab.active')?.dataset.tab || 'preview';
  elements.toggleDraftsButton.classList.toggle('active', !state.layout.draftsHidden);
  elements.toggleDraftsButton.classList.toggle('is-off', state.layout.draftsHidden);
  elements.jumpAssistantButton.classList.toggle('active', !state.layout.inspectorHidden && activeTab === 'assistant');
  elements.toggleInspectorButton.classList.toggle('active', !state.layout.inspectorHidden && activeTab !== 'assistant');
  elements.toggleInspectorButton.classList.toggle('is-off', state.layout.inspectorHidden);
}

function applyLayout() {
  const root = document.documentElement;
  root.style.setProperty('--drawer-width', `${state.layout.drawerWidth}px`);
  root.style.setProperty('--inspector-width', `${state.layout.inspectorWidth}px`);

  document.body.dataset.theme = state.layout.theme;
  document.body.classList.toggle('drafts-hidden', state.layout.draftsHidden);
  document.body.classList.toggle('inspector-hidden', state.layout.inspectorHidden);
  document.body.classList.toggle(
    'force-inspector',
    !state.layout.inspectorHidden && window.innerWidth <= 880
  );

  setButtonLabel(elements.themeButton, state.layout.theme === 'dark' ? 'Light mode' : 'Dark mode');
  setButtonLabel(elements.toggleDraftsButton, state.layout.draftsHidden ? 'Show drafts' : 'Drafts');
  setButtonLabel(elements.toggleInspectorButton, state.layout.inspectorHidden ? 'Show panel' : 'Hide panel');
  syncRailState();
}

// ---------- articles ----------

function activeArticle() {
  return state.articles.find((article) => article.id === state.activeId) || null;
}

function getEditorArticle() {
  const article = activeArticle();
  if (!article) return null;
  return {
    ...article,
    title: elements.titleInput.value.trim(),
    author: elements.authorInput.value.trim(),
    digest: elements.digestInput.value.trim(),
    sourceUrl: elements.sourceUrlInput.value.trim(),
    showCover: elements.showCoverInput.checked,
    openComment: elements.openCommentInput.checked,
    fansOnlyComment: elements.fansOnlyCommentInput.checked,
    contentMarkdown: elements.contentInput.value
  };
}

function formatSavedTime(article = {}) {
  const timestamp = article.updatedAt || article.createdAt;
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `Saved ${date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

function renderArticleList() {
  const term = state.searchTerm.trim().toLowerCase();
  const filtered = term
    ? state.articles.filter((article) =>
        `${article.title || ''} ${article.digest || ''} ${article.contentMarkdown || ''}`.toLowerCase().includes(term)
      )
    : state.articles;

  elements.draftCount.textContent = String(state.articles.length);
  elements.articleList.innerHTML = '';

  if (filtered.length === 0) {
    elements.articleList.innerHTML = `<div class="article-list-empty">${term ? 'No matching drafts' : 'No drafts yet'}</div>`;
    return;
  }

  for (const article of filtered) {
    const button = document.createElement('button');
    button.className = `article-item ${article.id === state.activeId ? 'active' : ''}`;
    const badge = article.wechat?.articleUrl
      ? '<span class="article-badge published">Published</span>'
      : article.wechat?.draftMediaId
        ? '<span class="article-badge">In draft box</span>'
        : '';
    button.innerHTML = `
      <span class="article-title">${escapeHtml(article.title || 'Untitled')}</span>
      <span class="article-time">${escapeHtml(formatSavedTime(article))}${badge}</span>
      <span class="article-meta">${escapeHtml(article.digest || article.contentMarkdown?.slice(0, 60) || 'No digest yet')}</span>
    `;
    button.addEventListener('click', async () => {
      if (article.id === state.activeId) return;
      await saveCurrentArticle({ quiet: true });
      state.activeId = article.id;
      render();
    });
    elements.articleList.appendChild(button);
  }
}

function renderEditor() {
  const article = activeArticle();
  const enabled = Boolean(article);
  const browserMode = isBrowserMode();
  [
    elements.titleInput, elements.authorInput, elements.contentInput,
    elements.digestInput, elements.sourceUrlInput,
    elements.showCoverInput, elements.openCommentInput, elements.fansOnlyCommentInput,
    elements.saveButton, elements.deleteButton, elements.insertImageButton,
    elements.assistantNote, elements.assistantSendButton, elements.assistantAttachButton
  ].forEach((element) => {
    element.disabled = !enabled;
  });
  elements.createDraftButton.disabled = !enabled || browserMode;

  if (!article) {
    elements.titleInput.value = '';
    elements.authorInput.value = '';
    elements.digestInput.value = '';
    elements.sourceUrlInput.value = '';
    elements.contentInput.value = '';
    renderPreview();
    renderCover();
    renderChat();
    renderPublishStatus();
    return;
  }

  elements.titleInput.value = article.title || '';
  elements.authorInput.value = article.author || '';
  elements.digestInput.value = article.digest || '';
  elements.sourceUrlInput.value = article.sourceUrl || '';
  elements.showCoverInput.checked = article.showCover !== false;
  elements.openCommentInput.checked = Boolean(article.openComment);
  elements.fansOnlyCommentInput.checked = Boolean(article.fansOnlyComment);
  elements.contentInput.value = article.contentMarkdown || '';

  renderPreview();
  renderCover();
  renderChat();
  renderPublishStatus();
}

function renderPreview() {
  const article = getEditorArticle();
  if (!article) {
    elements.preview.innerHTML = `
      <div class="empty-draft-state">
        <h1>No draft selected</h1>
        <p>Click + in the top-left corner to start a new draft.</p>
      </div>
    `;
    elements.wordCount.textContent = '';
    return;
  }

  elements.preview.innerHTML = `
    <h1>${escapeHtml(article.title || 'Untitled')}</h1>
    ${article.author ? `<p class="preview-byline">${escapeHtml(article.author)}</p>` : ''}
    ${article.digest ? `<blockquote>${escapeHtml(article.digest)}</blockquote>` : ''}
    ${markdownToHtml(article.contentMarkdown)}
  `;

  const characters = (article.contentMarkdown || '').replace(/\s/g, '').length;
  elements.wordCount.textContent = characters ? `${characters} chars` : '';
}

function renderCover() {
  const article = activeArticle();
  const coverPath = article?.coverPath || '';
  elements.coverPreview.hidden = !coverPath;
  elements.coverPlaceholder.hidden = Boolean(coverPath);
  elements.coverPreview.src = coverPath || '';
}

function renderPublishStatus() {
  const article = activeArticle();
  const browserMode = isBrowserMode();
  const wechatState = article?.wechat || {};
  const rows = [];
  if (wechatState.lastStatus) rows.push(`<span class="status-row"><b>Status</b>${escapeHtml(wechatState.lastStatus)}</span>`);
  if (wechatState.draftMediaId) rows.push(`<span class="status-row"><b>Draft ID</b><code>${escapeHtml(wechatState.draftMediaId)}</code></span>`);
  if (wechatState.publishId) rows.push(`<span class="status-row"><b>Publish ID</b><code>${escapeHtml(wechatState.publishId)}</code></span>`);
  if (wechatState.articleUrl) {
    rows.push(`<span class="status-row"><b>Article</b><a href="${escapeHtml(wechatState.articleUrl)}" target="_blank" rel="noopener">View on WeChat</a></span>`);
  }
  elements.publishStatus.innerHTML = rows.join('');
  elements.publishButton.disabled = browserMode || !article || !wechatState.draftMediaId;
  elements.statusButton.disabled = browserMode || !article || !wechatState.publishId;
}

function renderMode() {
  const browserMode = isBrowserMode();
  document.body.classList.toggle('browser-mode', browserMode);
  elements.publishCloudNote.hidden = !browserMode;
  elements.wechatSettingsSection.hidden = browserMode;
  if (browserMode) {
    elements.aiSettingsNote.textContent =
      'The assistant calls an OpenAI-compatible API directly from this browser with your own key. ' +
      'The key and all drafts are stored only in this browser (localStorage) — nothing is sent to any Plume server.';
  }
}

function renderSettings() {
  elements.assistantModelSelect.innerHTML = '';
  const models = [...new Set([state.settings.openaiModel, ...MODEL_OPTIONS].filter(Boolean))];
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    elements.assistantModelSelect.appendChild(option);
  }
  elements.assistantModelSelect.value = state.settings.openaiModel || MODEL_OPTIONS[0];

  elements.openaiBaseUrlInput.value = state.settings.openaiBaseUrl || '';
  elements.openaiModelInput.value = state.settings.openaiModel || '';
  elements.wechatAppIdInput.value = state.settings.wechatAppId || '';
  elements.settingsState.textContent = [
    `OpenAI key: ${state.settings.hasOpenaiApiKey ? 'saved' : 'not saved'}`,
    isBrowserMode() ? '' : `WeChat AppSecret: ${state.settings.hasWechatAppSecret ? 'saved' : 'not saved'}`
  ].filter(Boolean).join('\n');
}

function render() {
  applyLayout();
  renderMode();
  renderArticleList();
  renderEditor();
  renderAssistantAttachments();
  renderSettings();
}

// ---------- saving ----------

let saveTimer = null;
let dirtyToken = 0; // Incremented on every edit; identifies which edits a save covers.
let pendingSave = false; // A save was requested while another one was in flight.

function markDirty() {
  state.dirty = true;
  dirtyToken += 1;
  elements.saveState.textContent = 'Unsaved changes';
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveCurrentArticle({ quiet: true }), 900);
}

async function saveCurrentArticle({ quiet = false } = {}) {
  const article = getEditorArticle();
  if (!article) return article;
  if (state.saving) {
    // Don't drop the request: run another save once the current one finishes.
    pendingSave = true;
    return article;
  }

  state.saving = true;
  window.clearTimeout(saveTimer);
  const tokenAtSave = dirtyToken;
  try {
    const saved = await backend.updateArticle(article.id, article);
    const index = state.articles.findIndex((item) => item.id === saved.id);
    if (index >= 0) state.articles[index] = saved;
    // Only clear the dirty flag if nothing changed while the save was in flight.
    if (dirtyToken === tokenAtSave) {
      state.dirty = false;
      elements.saveState.textContent = `Saved ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (!quiet) {
      elements.saveButton.textContent = 'Saved';
      window.setTimeout(() => {
        elements.saveButton.textContent = 'Save';
      }, 900);
    }
    renderArticleList();
    return saved;
  } catch (error) {
    elements.saveState.textContent = `Save failed: ${error.message}`;
    return article;
  } finally {
    state.saving = false;
    if (pendingSave) {
      pendingSave = false;
      saveCurrentArticle({ quiet: true });
    }
  }
}

// Persist specific fields (chat, cover) without clobbering in-progress edits.
async function persistFields(articleId, payload) {
  const saved = await backend.updateArticle(articleId, payload);
  const index = state.articles.findIndex((item) => item.id === saved.id);
  if (index >= 0) state.articles[index] = saved;
  return saved;
}

// ---------- editor images ----------

function insertAtCursor(text) {
  const input = elements.contentInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '\n';
  const insertion = `${prefix}${text}${suffix}`;
  input.value = `${before}${insertion}${after}`;
  const cursor = before.length + insertion.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
  renderPreview();
  markDirty();
}

async function insertImageFile(file) {
  const url = await backend.uploadImage(file);
  const alt = (file.name || 'image').replace(/\.[^.]+$/, '');
  insertAtCursor(`![${alt}](${url})`);

  const article = activeArticle();
  if (article && !article.coverPath) {
    article.coverPath = url;
    renderCover();
  }
}

// ---------- assistant chat ----------

function chatMessages() {
  return activeArticle()?.chat || [];
}

function renderChat() {
  const messages = chatMessages();
  elements.assistantChat.querySelectorAll('.chat-message').forEach((node) => node.remove());
  elements.assistantEmpty.hidden = messages.length > 0;

  for (const message of messages) {
    elements.assistantChat.appendChild(buildMessageNode(message));
  }
  elements.assistantChat.scrollTop = elements.assistantChat.scrollHeight;
}

function buildMessageNode(message) {
  const node = document.createElement('div');
  node.className = `chat-message ${message.role}`;
  const body = document.createElement('div');
  body.className = 'chat-bubble';
  if (message.role === 'assistant') {
    body.innerHTML = markdownToHtml(message.content || '');
  } else {
    body.textContent = message.content || '';
  }
  node.appendChild(body);

  if (message.role === 'assistant' && message.content) {
    const actions = document.createElement('div');
    actions.className = 'chat-actions';

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', async () => {
      try {
        // navigator.clipboard is unavailable outside secure contexts (e.g. over LAN http).
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard API unavailable');
        }
        await navigator.clipboard.writeText(message.content);
        copyButton.textContent = 'Copied';
      } catch {
        copyButton.textContent = 'Copy failed';
        copyButton.title = 'Clipboard access is blocked here (needs HTTPS or localhost). Select the text manually.';
      }
      window.setTimeout(() => {
        copyButton.textContent = 'Copy';
      }, 1200);
    });

    const insertButton = document.createElement('button');
    insertButton.textContent = 'Insert into draft';
    insertButton.addEventListener('click', () => insertAtCursor(message.content.trim()));

    actions.append(copyButton, insertButton);
    node.appendChild(actions);
  }
  return node;
}

function renderAssistantAttachments() {
  elements.assistantAttachments.hidden = state.assistantAttachments.length === 0;
  elements.assistantAttachments.innerHTML = state.assistantAttachments
    .map(
      (attachment) => `
        <span class="assistant-attachment" title="${escapeHtml(attachment.status || '')}">
          <span class="assistant-attachment-name">${escapeHtml(attachment.name)}</span>
          <button type="button" data-remove-attachment="${escapeHtml(attachment.id)}" aria-label="Remove attachment">×</button>
        </span>
      `
    )
    .join('');
}

function readAttachmentFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '').slice(0, MAX_ATTACHMENT_BYTES);
      resolve({
        id: `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        content,
        truncated: file.size > MAX_ATTACHMENT_BYTES,
        status: file.size > MAX_ATTACHMENT_BYTES ? 'Text attached (truncated)' : 'Text attached'
      });
    };
    reader.onerror = () =>
      resolve({
        id: `attachment_${Date.now()}`,
        name: file.name,
        content: '',
        truncated: false,
        status: 'Could not read file'
      });
    reader.readAsText(file);
  });
}

async function addAttachmentFiles(files) {
  const readable = [...files].slice(0, 8 - state.assistantAttachments.length);
  const attachments = await Promise.all(readable.map(readAttachmentFile));
  state.assistantAttachments = [...state.assistantAttachments, ...attachments].slice(0, 8);
  renderAssistantAttachments();
}

async function runAssistant({ action = 'assist', note = '' } = {}) {
  if (state.streaming) return;
  const article = await saveCurrentArticle({ quiet: true });
  if (!article) return;

  const selection = elements.contentInput.value.slice(
    elements.contentInput.selectionStart,
    elements.contentInput.selectionEnd
  );

  const displayText = note || ACTION_PROMPTS[action] || '';
  const history = [...chatMessages()];
  const userMessage = { role: 'user', content: displayText, ts: new Date().toISOString() };
  article.chat = [...history, userMessage];
  renderChat();

  const assistantMessage = { role: 'assistant', content: '', ts: new Date().toISOString() };
  const pendingNode = buildMessageNode(assistantMessage);
  pendingNode.classList.add('streaming');
  elements.assistantChat.appendChild(pendingNode);
  const bubble = pendingNode.querySelector('.chat-bubble');
  bubble.innerHTML = '<span class="chat-typing">Thinking…</span>';
  elements.assistantChat.scrollTop = elements.assistantChat.scrollHeight;

  state.streaming = true;
  elements.assistantSendButton.disabled = true;

  try {
    let fullText = '';
    await backend.assistantStream(
      {
        article,
        selection,
        note,
        action,
        history,
        attachments: state.assistantAttachments,
        model: elements.assistantModelSelect.value
      },
      (delta) => {
        fullText += delta;
        bubble.innerHTML = markdownToHtml(fullText);
        elements.assistantChat.scrollTop = elements.assistantChat.scrollHeight;
      }
    );

    assistantMessage.content = fullText;
    article.chat = [...article.chat, assistantMessage];
    const saved = await persistFields(article.id, { chat: article.chat });
    if (state.activeId === saved.id) renderChat();
    state.assistantAttachments = [];
    renderAssistantAttachments();
  } catch (error) {
    bubble.innerHTML = `<span class="chat-error">${escapeHtml(error.message)}</span>`;
    await persistFields(article.id, { chat: article.chat }).catch(() => {});
  } finally {
    pendingNode.classList.remove('streaming');
    state.streaming = false;
    elements.assistantSendButton.disabled = !activeArticle();
  }
}

// ---------- publish ----------

function setWechatLog(payload) {
  elements.wechatLog.textContent =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function applyArticleUpdate(saved) {
  const index = state.articles.findIndex((item) => item.id === saved.id);
  if (index >= 0) state.articles[index] = saved;
  renderArticleList();
  renderPublishStatus();
}

async function handleCreateDraft() {
  const article = await saveCurrentArticle({ quiet: true });
  if (!article) return;
  if (!article.coverPath) {
    setWechatLog('Upload a cover image first — WeChat drafts require one.');
    return;
  }

  setBusy(elements.createDraftButton, true, 'Uploading…');
  try {
    const response = await backend.wechatDraft(article.id);
    applyArticleUpdate(response.article);
    setWechatLog({ message: 'Uploaded to the WeChat draft box.', ...response.result });
  } catch (error) {
    setWechatLog(error.message);
  } finally {
    setBusy(elements.createDraftButton, false);
  }
}

async function handlePublish() {
  const article = activeArticle();
  if (!article?.wechat?.draftMediaId) {
    setWechatLog('Upload to the draft box first.');
    return;
  }
  if (!window.confirm('Publishing pushes this article to readers immediately. Continue?\n\nWe recommend reviewing the draft in the WeChat admin console first.')) {
    return;
  }

  setBusy(elements.publishButton, true, 'Publishing…');
  try {
    const response = await backend.wechatPublish(article.id);
    applyArticleUpdate(response.article);
    setWechatLog({ message: 'Submitted. WeChat reviews asynchronously — click “Check publish status” in a bit.', ...response.result });
  } catch (error) {
    setWechatLog(error.message);
  } finally {
    setBusy(elements.publishButton, false);
  }
}

async function handleStatus() {
  const article = activeArticle();
  if (!article?.wechat?.publishId) {
    setWechatLog('No publish record yet.');
    return;
  }

  setBusy(elements.statusButton, true, 'Checking…');
  try {
    const response = await backend.wechatStatus(article.id);
    applyArticleUpdate(response.article);
    setWechatLog(response.status);
  } catch (error) {
    setWechatLog(error.message);
  } finally {
    setBusy(elements.statusButton, false);
  }
}

// ---------- settings ----------

function openSettings() {
  elements.settingsModal.hidden = false;
  elements.openaiApiKeyInput.focus();
}

function closeSettings() {
  elements.settingsModal.hidden = true;
}

async function saveSettings() {
  const settings = await backend.saveSettings({
    openaiApiKey: elements.openaiApiKeyInput.value.trim(),
    openaiBaseUrl: elements.openaiBaseUrlInput.value.trim(),
    openaiModel: elements.openaiModelInput.value.trim(),
    wechatAppId: elements.wechatAppIdInput.value.trim(),
    wechatAppSecret: elements.wechatAppSecretInput.value.trim()
  });
  state.settings = settings;
  elements.openaiApiKeyInput.value = '';
  elements.wechatAppSecretInput.value = '';
  renderSettings();
  elements.settingsState.textContent += '\nSettings saved.';
}

// ---------- resize ----------

function startResize(kind, event) {
  event.preventDefault();
  const startX = event.clientX;
  const start = {
    drawerWidth: state.layout.drawerWidth,
    inspectorWidth: state.layout.inspectorWidth
  };

  function move(pointerEvent) {
    const delta = pointerEvent.clientX - startX;
    if (kind === 'drafts') {
      state.layout.drawerWidth = clamp(start.drawerWidth + delta, 190, 360);
    } else {
      const maxInspectorWidth = clamp(window.innerWidth - 76 - state.layout.drawerWidth - 12 - 460, 360, 680);
      state.layout.inspectorWidth = clamp(start.inspectorWidth - delta, 360, maxInspectorWidth);
    }
    applyLayout();
  }

  function stop() {
    document.body.classList.remove('resizing');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    saveLayout();
  }

  document.body.classList.add('resizing');
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}

// ---------- tabs ----------

function setActiveTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const panel = document.querySelector(`#${tabName}Panel`);
  if (!tab || !panel) return;
  document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.panel').forEach((item) => item.classList.remove('active'));
  tab.classList.add('active');
  panel.classList.add('active');
  if (window.location.hash.slice(1) !== tabName) {
    history.replaceState(null, '', `#${tabName}`);
  }
  syncRailState();
}

// ---------- events ----------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
});

elements.draftResizeHandle.addEventListener('pointerdown', (event) => startResize('drafts', event));
elements.inspectorResizeHandle.addEventListener('pointerdown', (event) => startResize('inspector', event));

elements.themeButton.addEventListener('click', () => {
  state.layout.theme = state.layout.theme === 'dark' ? 'light' : 'dark';
  applyLayout();
  saveLayout();
});

elements.toggleDraftsButton.addEventListener('click', () => {
  state.layout.draftsHidden = !state.layout.draftsHidden;
  applyLayout();
  saveLayout();
});

elements.jumpAssistantButton.addEventListener('click', () => {
  state.layout.inspectorHidden = false;
  setActiveTab('assistant');
  applyLayout();
  saveLayout();
  elements.assistantNote.focus();
});

elements.toggleInspectorButton.addEventListener('click', () => {
  state.layout.inspectorHidden = !state.layout.inspectorHidden;
  applyLayout();
  saveLayout();
});

elements.resetLayoutButton.addEventListener('click', () => {
  state.layout = { ...DEFAULT_LAYOUT };
  applyLayout();
  saveLayout();
});

elements.searchInput.addEventListener('input', () => {
  state.searchTerm = elements.searchInput.value;
  renderArticleList();
});

elements.newArticleButton.addEventListener('click', async () => {
  await saveCurrentArticle({ quiet: true });
  const article = await backend.createArticle();
  state.articles.unshift(article);
  state.activeId = article.id;
  render();
  elements.titleInput.focus();
});

elements.saveButton.addEventListener('click', () => saveCurrentArticle());

elements.deleteButton.addEventListener('click', async () => {
  const article = activeArticle();
  if (!article) return;
  if (!window.confirm(`Delete “${article.title || 'Untitled'}”? This cannot be undone.`)) return;
  const data = await backend.deleteArticle(article.id);
  state.articles = data.articles || [];
  state.activeId = state.articles[0]?.id || '';
  render();
});

[
  elements.titleInput, elements.authorInput, elements.digestInput,
  elements.sourceUrlInput, elements.contentInput
].forEach((input) => {
  input.addEventListener('input', () => {
    renderPreview();
    markDirty();
  });
});

[elements.showCoverInput, elements.openCommentInput, elements.fansOnlyCommentInput].forEach((input) => {
  input.addEventListener('change', markDirty);
});

// auto-grow the title textarea
elements.titleInput.addEventListener('input', () => {
  elements.titleInput.style.height = 'auto';
  elements.titleInput.style.height = `${elements.titleInput.scrollHeight}px`;
});

// editor images: button, drag-drop, paste
elements.insertImageButton.addEventListener('click', () => elements.editorImageInput.click());
elements.editorImageInput.addEventListener('change', async () => {
  for (const file of elements.editorImageInput.files) {
    try {
      await insertImageFile(file);
    } catch (error) {
      window.alert(error.message);
    }
  }
  elements.editorImageInput.value = '';
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

elements.contentInput.addEventListener('dragover', (event) => {
  if ([...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith('image/'))) {
    event.preventDefault();
    elements.contentInput.classList.add('image-drag-over');
  }
});

elements.contentInput.addEventListener('dragleave', () => {
  elements.contentInput.classList.remove('image-drag-over');
});

elements.contentInput.addEventListener('drop', async (event) => {
  event.preventDefault();
  elements.contentInput.classList.remove('image-drag-over');
  for (const file of event.dataTransfer?.files || []) {
    if (file.type.startsWith('image/')) {
      try {
        await insertImageFile(file);
      } catch (error) {
        window.alert(error.message);
      }
    }
  }
});

elements.contentInput.addEventListener('paste', async (event) => {
  const images = [...(event.clipboardData?.items || [])].filter((item) => item.type.startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  for (const item of images) {
    const file = item.getAsFile();
    if (file) {
      try {
        await insertImageFile(file);
      } catch (error) {
        window.alert(error.message);
      }
    }
  }
});

// cover uploader
elements.coverUploader.addEventListener('click', () => elements.coverFileInput.click());
elements.coverFileInput.addEventListener('change', async () => {
  const file = elements.coverFileInput.files[0];
  elements.coverFileInput.value = '';
  const article = activeArticle();
  if (!file || !article) return;
  try {
    const url = await backend.uploadImage(file);
    article.coverPath = url;
    renderCover();
    await persistFields(article.id, { coverPath: url });
  } catch (error) {
    setWechatLog(error.message);
  }
});

// assistant
elements.assistantSendButton.addEventListener('click', () => {
  const note = elements.assistantNote.value.trim();
  if (!note) return;
  elements.assistantNote.value = '';
  runAssistant({ action: 'assist', note });
});

elements.assistantNote.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    elements.assistantSendButton.click();
  }
});

elements.assistantActions.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-action]');
  if (!chip || state.streaming) return;
  runAssistant({ action: chip.dataset.action, note: elements.assistantNote.value.trim() });
  elements.assistantNote.value = '';
});

elements.clearChatButton.addEventListener('click', async () => {
  const article = activeArticle();
  if (!article?.chat?.length) return;
  if (!window.confirm('Clear the AI conversation for this article?')) return;
  article.chat = [];
  renderChat();
  await persistFields(article.id, { chat: [] });
});

elements.assistantAttachButton.addEventListener('click', () => elements.assistantFileInput.click());
elements.assistantFileInput.addEventListener('change', async () => {
  await addAttachmentFiles(elements.assistantFileInput.files);
  elements.assistantFileInput.value = '';
});

elements.assistantAttachments.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-attachment]');
  if (!button) return;
  state.assistantAttachments = state.assistantAttachments.filter(
    (attachment) => attachment.id !== button.dataset.removeAttachment
  );
  renderAssistantAttachments();
});

const assistantComposer = document.querySelector('.assistant-composer');
['dragenter', 'dragover'].forEach((eventName) => {
  assistantComposer.addEventListener(eventName, (event) => {
    event.preventDefault();
    assistantComposer.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((eventName) => {
  assistantComposer.addEventListener(eventName, () => assistantComposer.classList.remove('drag-over'));
});
assistantComposer.addEventListener('drop', async (event) => {
  event.preventDefault();
  await addAttachmentFiles(event.dataTransfer?.files || []);
});

elements.assistantModelSelect.addEventListener('change', async () => {
  state.settings = await backend.saveSettings({ openaiModel: elements.assistantModelSelect.value });
  renderSettings();
});

// publish
elements.createDraftButton.addEventListener('click', handleCreateDraft);
elements.publishButton.addEventListener('click', handlePublish);
elements.statusButton.addEventListener('click', handleStatus);

// settings modal
elements.openSettingsButton.addEventListener('click', openSettings);
elements.closeSettingsButton.addEventListener('click', closeSettings);
elements.settingsModal.addEventListener('click', (event) => {
  if (event.target === elements.settingsModal) closeSettings();
});

elements.saveSettingsButton.addEventListener('click', async () => {
  try {
    await saveSettings();
  } catch (error) {
    elements.settingsState.textContent = `Save failed: ${error.message}`;
  }
});

elements.testOpenaiButton.addEventListener('click', async () => {
  setBusy(elements.testOpenaiButton, true, 'Testing…');
  try {
    const result = await backend.assistantTest(elements.openaiModelInput.value.trim() || undefined);
    elements.settingsState.textContent = `AI connection OK (model: ${result.model})`;
  } catch (error) {
    elements.settingsState.textContent = `AI connection failed: ${error.message}`;
  } finally {
    setBusy(elements.testOpenaiButton, false);
  }
});

elements.testWechatButton.addEventListener('click', async () => {
  setBusy(elements.testWechatButton, true, 'Testing…');
  try {
    const result = await backend.wechatTest();
    elements.settingsState.textContent = `WeChat connection OK (token: ${result.tokenPreview})`;
  } catch (error) {
    elements.settingsState.textContent = `WeChat connection failed: ${error.message}`;
  } finally {
    setBusy(elements.testWechatButton, false);
  }
});

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveCurrentArticle();
  }
  if (event.key === 'Escape' && !elements.settingsModal.hidden) {
    closeSettings();
  }
});

window.addEventListener('resize', applyLayout);

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---------- boot ----------

async function load() {
  try {
    backend = await createBackend();
    const data = backend.initialData || (await backend.getData());
    state.articles = data.articles || [];
    state.settings = data.settings || {};
    state.activeId = state.articles[0]?.id || '';
    elements.dataPath.textContent = data.dataPath || '';
    render();
  } catch (error) {
    elements.preview.innerHTML = `<div class="empty-draft-state"><h1>Failed to load</h1><p>${escapeHtml(error.message)}</p></div>`;
  }
}

applyLayout();
const initialTab = window.location.hash.slice(1);
if (['preview', 'assistant', 'publish'].includes(initialTab)) {
  setActiveTab(initialTab);
}
load();
