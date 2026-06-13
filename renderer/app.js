window.__WEWRITE_SCRIPT_STARTED = true;

function createPreviewBridge() {
  const timestamp = new Date().toISOString();
  let article = {
    id: 'preview_article',
    title: 'Designing a Local Writing Workflow',
    author: 'Allen',
    digest: 'A calm desk for drafting, editing, and shipping WeChat articles with AI support.',
    sourceUrl: '',
    coverPath: '',
    showCover: true,
    openComment: false,
    fansOnlyComment: false,
    contentMarkdown:
      '## Start with the draft\n\nThis preview runs without Electron so the layout can be checked in a browser.\n\n- Use the left sheet as the writing surface\n- Keep preview, assistant, and publishing in the right panel\n- Resize or hide the draft drawer and tool panel\n\nWhen the desktop app runs, these controls use the real local data and publishing services.',
    wechat: {
      draftMediaId: '',
      publishId: '',
      articleId: '',
      lastStatus: ''
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    loadData: async () => ({
      articles: [article],
      settings: {
        openaiModel: 'gpt-5.4-mini',
        hasOpenaiApiKey: false,
        wechatAppId: '',
        hasWechatAppSecret: false
      },
      dataPath: 'Browser preview'
    }),
    createArticle: async () => ({ ...article, id: `preview_${Date.now()}`, title: 'Untitled Article' }),
    saveArticle: async (nextArticle) => {
      article = { ...nextArticle, updatedAt: new Date().toISOString() };
      return article;
    },
    deleteArticle: async () => ({ articles: [], settings: {}, dataPath: 'Browser preview' }),
    saveSettings: async (settings) => ({
      openaiModel: settings.openaiModel || 'gpt-5.4-mini',
      hasOpenaiApiKey: Boolean(settings.openaiApiKey),
      wechatAppId: settings.wechatAppId || '',
      hasWechatAppSecret: Boolean(settings.wechatAppSecret)
    }),
    chooseImage: async () => '',
    chooseFiles: async () => [
      {
        id: 'preview_attachment',
        name: 'example-notes.md',
        path: 'Browser preview',
        extension: '.md',
        size: 128,
        kind: 'text',
        content: 'Preview attachment text.',
        truncated: false,
        status: 'Text attached.'
      }
    ],
    readAttachments: async (filePaths = []) =>
      filePaths.map((filePath, index) => ({
        id: `preview_attachment_${index}`,
        name: filePath.split('/').pop() || 'Attachment',
        path: filePath,
        extension: '',
        size: 0,
        kind: 'file',
        content: '',
        truncated: false,
        status: 'Browser preview attachment.'
      })),
    runAssistant: async ({ action }) => ({
      action,
      label: action,
      text: 'Browser preview mode: AI calls are available in the packaged desktop app after you add an OpenAI API key.',
      model: 'gpt-5.4-mini'
    }),
    testWechat: async () => ({ ok: true, tokenPreview: 'preview-token' }),
    createWechatDraft: async ({ article: nextArticle }) => ({
      result: { mediaId: 'preview_media_id', coverMediaId: 'preview_cover_id' },
      article: {
        ...nextArticle,
        wechat: { ...(nextArticle.wechat || {}), draftMediaId: 'preview_media_id' }
      }
    }),
    publishWechatDraft: async () => ({ publishId: 'preview_publish_id' }),
    getWechatStatus: async () => ({ publish_id: 'preview_publish_id', publish_status: 0 })
  };
}

const bridge = window.writingDesk || createPreviewBridge();

const DEFAULT_LAYOUT = {
  theme: 'light',
  drawerWidth: 224,
  inspectorWidth: 420,
  draftsHidden: false,
  inspectorHidden: false
};

const state = {
  articles: [],
  settings: {},
  layout: loadLayout(),
  activeId: '',
  assistantAttachments: [],
  saving: false
};

const elements = {
  articleList: document.querySelector('#articleList'),
  dataPath: document.querySelector('#dataPath'),
  titleInput: document.querySelector('#titleInput'),
  authorInput: document.querySelector('#authorInput'),
  digestInput: document.querySelector('#digestInput'),
  sourceUrlInput: document.querySelector('#sourceUrlInput'),
  coverPathInput: document.querySelector('#coverPathInput'),
  showCoverInput: document.querySelector('#showCoverInput'),
  openCommentInput: document.querySelector('#openCommentInput'),
  contentInput: document.querySelector('#contentInput'),
  preview: document.querySelector('#preview'),
  saveButton: document.querySelector('#saveButton'),
  deleteButton: document.querySelector('#deleteButton'),
  newArticleButton: document.querySelector('#newArticleButton'),
  toggleDraftsButton: document.querySelector('#toggleDraftsButton'),
  jumpAssistantButton: document.querySelector('#jumpAssistantButton'),
  toggleInspectorButton: document.querySelector('#toggleInspectorButton'),
  themeButton: document.querySelector('#themeButton'),
  draftResizeHandle: document.querySelector('#draftResizeHandle'),
  inspectorResizeHandle: document.querySelector('#inspectorResizeHandle'),
  draftCount: document.querySelector('#draftCount'),
  assistantAttachments: document.querySelector('#assistantAttachments'),
  assistantNote: document.querySelector('#assistantNote'),
  assistantModelSelect: document.querySelector('#assistantModelSelect'),
  assistantAttachButton: document.querySelector('#assistantAttachButton'),
  assistantSendButton: document.querySelector('#assistantSendButton'),
  assistantOutput: document.querySelector('#assistantOutput'),
  wechatLog: document.querySelector('#wechatLog'),
  openaiApiKeyInput: document.querySelector('#openaiApiKeyInput'),
  wechatAppIdInput: document.querySelector('#wechatAppIdInput'),
  wechatAppSecretInput: document.querySelector('#wechatAppSecretInput'),
  settingsState: document.querySelector('#settingsState'),
  resetLayoutButton: document.querySelector('#resetLayoutButton'),
  settingsModal: document.querySelector('#settingsModal'),
  openSettingsButton: document.querySelector('#openSettingsButton'),
  closeSettingsButton: document.querySelector('#closeSettingsButton')
};

function loadLayout() {
  try {
    const stored = JSON.parse(localStorage.getItem('wewrite-layout') || '{}');
    const rawDrawerWidth = stored.drawerWidth || stored.sidebarWidth || DEFAULT_LAYOUT.drawerWidth;
    const drawerWidth = clamp(rawDrawerWidth, 190, 360);
    const rawInspectorWidth =
      stored.inspectorWidth && stored.inspectorWidth >= 360
        ? stored.inspectorWidth
        : DEFAULT_LAYOUT.inspectorWidth;
    const maxInspectorWidth = clamp(window.innerWidth - 76 - drawerWidth - 12 - 460, 360, 620);
    return {
      ...DEFAULT_LAYOUT,
      ...stored,
      drawerWidth,
      inspectorWidth: clamp(rawInspectorWidth, 360, maxInspectorWidth),
      draftsHidden:
        typeof stored.draftsHidden === 'boolean'
          ? stored.draftsHidden
          : Boolean(stored.sidebarHidden)
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function saveLayout() {
  localStorage.setItem('wewrite-layout', JSON.stringify(state.layout));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  elements.jumpAssistantButton.classList.toggle(
    'active',
    !state.layout.inspectorHidden && activeTab === 'assistant'
  );
  elements.toggleInspectorButton.classList.toggle(
    'active',
    !state.layout.inspectorHidden && activeTab !== 'assistant'
  );
  elements.toggleInspectorButton.classList.toggle('is-off', state.layout.inspectorHidden);
}

function applyLayout() {
  const root = document.documentElement;
  root.style.setProperty('--drawer-width', `${state.layout.drawerWidth}px`);
  root.style.setProperty('--inspector-width', `${state.layout.inspectorWidth}px`);

  document.body.dataset.theme = state.layout.theme;
  document.body.classList.toggle('drafts-hidden', state.layout.draftsHidden);
  document.body.classList.toggle('inspector-hidden', state.layout.inspectorHidden);

  const themeLabel = state.layout.theme === 'dark' ? 'Light mode' : 'Dark mode';
  elements.themeButton.title = themeLabel;
  elements.themeButton.setAttribute('aria-label', themeLabel);
  elements.themeButton.dataset.tooltip = themeLabel;
  setButtonLabel(elements.toggleDraftsButton, state.layout.draftsHidden ? 'Show drafts' : 'Drafts');
  setButtonLabel(elements.toggleInspectorButton, state.layout.inspectorHidden ? 'Show panel' : 'Hide panel');
  syncRailState();
}

function activeArticle() {
  return state.articles.find((article) => article.id === state.activeId) || state.articles[0];
}

function setDraftControlsEnabled(enabled) {
  [
    elements.titleInput,
    elements.authorInput,
    elements.contentInput,
    elements.showCoverInput,
    elements.openCommentInput,
    elements.saveButton,
    elements.deleteButton,
    elements.digestInput,
    elements.sourceUrlInput,
    elements.assistantNote,
    elements.assistantAttachButton,
    elements.assistantSendButton,
    document.querySelector('#createDraftButton')
  ].forEach((element) => {
    if (element) {
      element.disabled = !enabled;
    }
  });

  document.body.classList.toggle('no-active-draft', !enabled);
}

function clearEditorFields() {
  elements.titleInput.value = '';
  elements.authorInput.value = '';
  elements.digestInput.value = '';
  elements.sourceUrlInput.value = '';
  elements.coverPathInput.value = '';
  elements.showCoverInput.checked = true;
  elements.openCommentInput.checked = false;
  elements.contentInput.value = '';
  elements.assistantNote.value = '';
  elements.assistantOutput.textContent = '';
  setWechatLog('');
  state.assistantAttachments = [];
}

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function filePathToUrl(filePath = '') {
  if (!filePath) return '';
  if (/^(blob|data|file|https?):/i.test(filePath)) return filePath;

  const normalized = filePath.replaceAll('\\', '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return `${prefix}${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

function fileNameFromPath(filePath = '') {
  return filePath.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'Imported image';
}

function imageAltFromPath(filePath = '') {
  if (/^data:/i.test(filePath)) return 'Image';
  return fileNameFromPath(filePath).replace(/\.[^.]+$/, '').replace(/[[\]\n\r]/g, ' ').trim() || 'Image';
}

function isImageFile(file) {
  return Boolean(file && (/^image\//.test(file.type) || /\.(jpe?g|png|webp|gif)$/i.test(file.name || '')));
}

function droppedFilePaths(event) {
  return Array.from(event.dataTransfer?.files || [])
    .map((file) => file.path)
    .filter(Boolean);
}

function droppedImagePaths(event) {
  return Array.from(event.dataTransfer?.files || [])
    .filter(isImageFile)
    .map((file) => file.path)
    .filter(Boolean);
}

function formatFileSize(bytes = 0) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSavedTime(article = {}) {
  const timestamp = article.updatedAt || article.createdAt;
  if (!timestamp) return 'Saved time unknown';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Saved time unknown';

  return `Saved ${date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, alt, src) => `<img alt="${alt}" src="${escapeHtml(filePathToUrl(src))}" />`
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function markdownToHtml(markdown = '') {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listOpen = false;

  function closeList() {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join('\n');
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
    coverPath: elements.coverPathInput.value.trim(),
    showCover: elements.showCoverInput.checked,
    openComment: elements.openCommentInput.checked,
    contentMarkdown: elements.contentInput.value
  };
}

function renderArticleList() {
  elements.articleList.innerHTML = '';
  elements.draftCount.textContent = String(state.articles.length);
  if (state.articles.length === 0) {
    elements.articleList.innerHTML = '<div class="article-list-empty">No drafts yet</div>';
    return;
  }

  for (const article of state.articles) {
    const button = document.createElement('button');
    button.className = `article-item ${article.id === state.activeId ? 'active' : ''}`;
    button.innerHTML = `
      <span class="article-title">${escapeHtml(article.title || 'Untitled Article')}</span>
      <span class="article-time">${escapeHtml(formatSavedTime(article))}</span>
      <span class="article-meta">${escapeHtml(article.digest || 'No summary yet')}</span>
    `;
    button.addEventListener('click', async () => {
      await saveCurrentArticle({ quiet: true });
      state.activeId = article.id;
      render();
    });
    elements.articleList.appendChild(button);
  }
}

async function insertImageAtCursor(filePath, { save = true } = {}) {
  if (!filePath) return;

  const input = elements.contentInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const imageMarkdown = `![${imageAltFromPath(filePath)}](${filePathToUrl(filePath)})`;
  const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n\n' : '\n';
  const insertion = `${prefix}${imageMarkdown}${suffix}`;
  const cursorPosition = before.length + insertion.length;

  input.value = `${before}${insertion}${after}`;
  input.focus();
  input.setSelectionRange(cursorPosition, cursorPosition);

  if (!elements.coverPathInput.value.trim()) {
    elements.coverPathInput.value = filePath;
  }

  renderPreview();
  if (save) {
    await saveCurrentArticle({ quiet: true });
  }
}

function renderEditor() {
  const article = activeArticle();
  setDraftControlsEnabled(Boolean(article));
  if (!article) {
    clearEditorFields();
    renderPreview();
    return;
  }

  elements.titleInput.value = article.title || '';
  elements.authorInput.value = article.author || '';
  elements.digestInput.value = article.digest || '';
  elements.sourceUrlInput.value = article.sourceUrl || '';
  elements.coverPathInput.value = article.coverPath || '';
  elements.showCoverInput.checked = article.showCover !== false;
  elements.openCommentInput.checked = Boolean(article.openComment);
  elements.contentInput.value = article.contentMarkdown || '';

  renderPreview();
}

function renderPreview() {
  const article = getEditorArticle();
  if (!article) {
    elements.preview.innerHTML = `
      <div class="empty-draft-state">
        <h1>No draft selected</h1>
        <p>Create a new draft to start writing.</p>
      </div>
    `;
    return;
  }

  const html = markdownToHtml(article.contentMarkdown);
  elements.preview.innerHTML = `
    <h1>${escapeHtml(article.title || 'Untitled Article')}</h1>
    ${article.digest ? `<blockquote>${escapeHtml(article.digest)}</blockquote>` : ''}
    ${html}
  `;
}

function renderAssistantAttachments() {
  elements.assistantAttachments.hidden = state.assistantAttachments.length === 0;
  elements.assistantAttachments.innerHTML = state.assistantAttachments
    .map((attachment) => {
      const status = attachment.status || (attachment.content ? 'Text attached.' : 'Attached.');
      const size = formatFileSize(attachment.size);
      return `
        <span class="assistant-attachment" title="${escapeHtml(status)}">
          <span class="assistant-attachment-name">${escapeHtml(attachment.name || 'Attachment')}</span>
          ${size ? `<span class="assistant-attachment-size">${escapeHtml(size)}</span>` : ''}
          <button type="button" data-remove-attachment="${escapeHtml(attachment.id)}" aria-label="Remove attachment">x</button>
        </span>
      `;
    })
    .join('');
}

function addAssistantAttachments(attachments = []) {
  const byPath = new Map(state.assistantAttachments.map((attachment) => [attachment.path, attachment]));
  for (const attachment of attachments) {
    if (attachment?.path) {
      byPath.set(attachment.path, attachment);
    }
  }
  state.assistantAttachments = [...byPath.values()].slice(0, 8);
  renderAssistantAttachments();
}

async function attachFilesFromPaths(filePaths = []) {
  if (!filePaths.length || !bridge.readAttachments) return;
  const attachments = await bridge.readAttachments(filePaths);
  addAssistantAttachments(attachments);
}

function renderSettings() {
  elements.assistantModelSelect.value = state.settings.openaiModel || 'gpt-5.4-mini';
  elements.wechatAppIdInput.value = state.settings.wechatAppId || '';
  elements.settingsState.textContent = [
    `OpenAI key: ${state.settings.hasOpenaiApiKey ? 'saved' : 'not saved'}`,
    `WeChat AppSecret: ${state.settings.hasWechatAppSecret ? 'saved' : 'not saved'}`,
    `Theme: ${state.layout.theme}`,
    `Layout: drafts ${state.layout.draftsHidden ? 'hidden' : `${state.layout.drawerWidth}px`}, panel ${
      state.layout.inspectorHidden ? 'hidden' : `${state.layout.inspectorWidth}px`
    }`
  ].join('\n');
}

function render() {
  applyLayout();
  renderArticleList();
  renderEditor();
  renderAssistantAttachments();
  renderSettings();
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.textContent = label;
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

function setWechatLog(payload) {
  elements.wechatLog.textContent =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

async function saveCurrentArticle({ quiet = false } = {}) {
  const article = getEditorArticle();
  if (!article) return null;
  if (state.saving) return article;

  state.saving = true;
  try {
    const saved = await bridge.saveArticle(article);
    const index = state.articles.findIndex((item) => item.id === saved.id);
    if (index >= 0) {
      state.articles[index] = saved;
    }
    if (!quiet) {
      elements.saveButton.textContent = 'Saved';
      window.setTimeout(() => {
        elements.saveButton.textContent = 'Save';
      }, 900);
    }
    renderArticleList();
    return saved;
  } finally {
    state.saving = false;
  }
}

async function load() {
  const data = await bridge.loadData();
  state.articles = data.articles || [];
  state.settings = data.settings || {};
  state.activeId = state.articles[0]?.id || '';
  elements.dataPath.textContent = data.dataPath || '';
  render();
}

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
    }
    if (kind === 'inspector') {
      const maxInspectorWidth = clamp(window.innerWidth - 76 - state.layout.drawerWidth - 12 - 460, 360, 620);
      state.layout.inspectorWidth = clamp(start.inspectorWidth - delta, 360, maxInspectorWidth);
    }
    applyLayout();
  }

  function stop() {
    document.body.classList.remove('resizing');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    saveLayout();
    renderSettings();
  }

  document.body.classList.add('resizing');
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}

function openSettings() {
  elements.settingsModal.hidden = false;
  elements.settingsModal.removeAttribute('hidden');
  elements.openaiApiKeyInput.focus();
}

function closeSettings() {
  elements.settingsModal.hidden = true;
  elements.settingsModal.setAttribute('hidden', '');
}

function setupTransientScrollbars() {
  const scrollables = document.querySelectorAll(
    [
      '.article-list',
      '.editor-stage',
      '#contentInput',
      '.panel',
      '.assistant-home',
      '.assistant-output',
      '.assistant-input',
      '#wechatLog',
      '.settings-body'
    ].join(',')
  );

  scrollables.forEach((element) => {
    let hideTimer;

    function showScrollbar() {
      element.classList.add('scroll-reveal', 'is-scrolling');
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        element.classList.remove('is-scrolling');
      }, 760);
    }

    element.classList.add('scroll-reveal');
    element.addEventListener('scroll', showScrollbar, { passive: true });
    element.addEventListener('wheel', showScrollbar, { passive: true });
    element.addEventListener('touchmove', showScrollbar, { passive: true });
  });
}

function setActiveTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const panel = document.querySelector(`#${tabName}Panel`);
  if (!tab || !panel) return;

  document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.panel').forEach((item) => item.classList.remove('active'));
  tab.classList.add('active');
  panel.classList.add('active');
  syncRailState();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
});

elements.draftResizeHandle.addEventListener('pointerdown', (event) => startResize('drafts', event));
elements.inspectorResizeHandle.addEventListener('pointerdown', (event) => startResize('inspector', event));

elements.themeButton.addEventListener('click', () => {
  state.layout.theme = state.layout.theme === 'dark' ? 'light' : 'dark';
  applyLayout();
  saveLayout();
  renderSettings();
});

elements.openSettingsButton.addEventListener('click', openSettings);
elements.closeSettingsButton.addEventListener('click', closeSettings);
elements.openSettingsButton.onclick = openSettings;
elements.closeSettingsButton.onclick = closeSettings;
window.__WEWRITE_OPEN_SETTINGS = openSettings;
window.__WEWRITE_CLOSE_SETTINGS = closeSettings;
document.addEventListener(
  'click',
  (event) => {
    if (event.target.closest('#openSettingsButton')) {
      event.preventDefault();
      openSettings();
    }
    if (event.target.closest('#closeSettingsButton')) {
      event.preventDefault();
      closeSettings();
    }
  },
  true
);
elements.settingsModal.addEventListener('click', (event) => {
  if (event.target === elements.settingsModal) {
    closeSettings();
  }
});

elements.assistantModelSelect.addEventListener('change', async () => {
  const settings = await bridge.saveSettings({
    openaiModel: elements.assistantModelSelect.value
  });
  state.settings = settings;
  renderSettings();
});

function toggleDrafts() {
  state.layout.draftsHidden = !state.layout.draftsHidden;
  applyLayout();
  saveLayout();
  renderSettings();
}

elements.toggleDraftsButton.addEventListener('click', toggleDrafts);

elements.jumpAssistantButton.addEventListener('click', () => {
  state.layout.inspectorHidden = false;
  setActiveTab('assistant');
  applyLayout();
  saveLayout();
  renderSettings();
});

elements.toggleInspectorButton.addEventListener('click', () => {
  state.layout.inspectorHidden = !state.layout.inspectorHidden;
  applyLayout();
  saveLayout();
  renderSettings();
});

elements.resetLayoutButton.addEventListener('click', () => {
  state.layout = { ...DEFAULT_LAYOUT };
  applyLayout();
  saveLayout();
  renderSettings();
});

elements.newArticleButton.addEventListener('click', async () => {
  await saveCurrentArticle({ quiet: true });
  const article = await bridge.createArticle();
  state.articles.unshift(article);
  state.activeId = article.id;
  render();
});

elements.saveButton.addEventListener('click', () => saveCurrentArticle());

elements.deleteButton.addEventListener('click', async () => {
  const article = activeArticle();
  if (!article) return;
  if (!window.confirm(`Delete "${article.title || 'Untitled Article'}"?`)) return;
  const data = await bridge.deleteArticle(article.id);
  state.articles = data.articles || [];
  state.activeId = state.articles[0]?.id || '';
  render();
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

elements.contentInput.addEventListener('dragover', (event) => {
  if (droppedImagePaths(event).length) {
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
  for (const filePath of droppedImagePaths(event)) {
    await insertImageAtCursor(filePath, { save: false });
  }
  await saveCurrentArticle({ quiet: true });
});

elements.assistantAttachButton.addEventListener('click', async () => {
  if (!bridge.chooseFiles) return;
  const attachments = await bridge.chooseFiles();
  addAssistantAttachments(attachments);
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
  assistantComposer.addEventListener(eventName, () => {
    assistantComposer.classList.remove('drag-over');
  });
});

assistantComposer.addEventListener('drop', async (event) => {
  event.preventDefault();
  await attachFilesFromPaths(droppedFilePaths(event));
});

[
  elements.titleInput,
  elements.authorInput,
  elements.digestInput,
  elements.sourceUrlInput,
  elements.coverPathInput,
  elements.contentInput,
  elements.showCoverInput,
  elements.openCommentInput
].forEach((input) => {
  input.addEventListener('input', renderPreview);
});

async function runAssistantRequest() {
  const article = await saveCurrentArticle({ quiet: true });
  if (!article) {
    elements.assistantOutput.textContent = 'Create a draft first.';
    return;
  }

  const selection = elements.contentInput.value.slice(
    elements.contentInput.selectionStart,
    elements.contentInput.selectionEnd
  );

  setBusy(elements.assistantSendButton, true, '...');
  elements.assistantOutput.textContent = '';

  try {
    const result = await bridge.runAssistant({
      action: 'assist',
      article,
      selection,
      note: elements.assistantNote.value.trim(),
      attachments: state.assistantAttachments
    });
    elements.assistantOutput.textContent = result.text;
  } catch (error) {
    elements.assistantOutput.textContent = error.message;
  } finally {
    setBusy(elements.assistantSendButton, false);
  }
}

elements.assistantSendButton.addEventListener('click', runAssistantRequest);
elements.assistantNote.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    runAssistantRequest();
  }
});

document.querySelector('#saveSettingsButton').addEventListener('click', async () => {
  const settings = await bridge.saveSettings({
    openaiApiKey: elements.openaiApiKeyInput.value.trim(),
    wechatAppId: elements.wechatAppIdInput.value.trim(),
    wechatAppSecret: elements.wechatAppSecretInput.value.trim()
  });
  state.settings = settings;
  elements.openaiApiKeyInput.value = '';
  elements.wechatAppSecretInput.value = '';
  renderSettings();
});

document.querySelector('#createDraftButton').addEventListener('click', async (event) => {
  const article = await saveCurrentArticle({ quiet: true });
  if (!article) {
    setWechatLog('Create a draft first.');
    return;
  }

  setBusy(event.currentTarget, true, 'Uploading');
  try {
    const response = await bridge.createWechatDraft({
      article,
      htmlContent: markdownToHtml(article.contentMarkdown)
    });
    const index = state.articles.findIndex((item) => item.id === response.article.id);
    if (index >= 0) {
      state.articles[index] = response.article;
    }
    setWechatLog({
      message: 'Uploaded to WeChat draft box.',
      ...response.result
    });
  } catch (error) {
    setWechatLog(error.message);
  } finally {
    setBusy(event.currentTarget, false);
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

setupTransientScrollbars();
applyLayout();
load();
window.__WEWRITE_READY = true;
