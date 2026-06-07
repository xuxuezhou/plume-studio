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
      '## Start with the draft\n\nThis preview runs without Electron so the layout can be checked in a browser.\n\n- Use the left sheet as the writing surface\n- Keep preview, assistant, and publishing in the right panel\n- Resize or hide the draft drawer and tool panel\n\nWhen the Mac app runs, these controls use the real local data and publishing services.',
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
    runAssistant: async ({ action }) => ({
      action,
      label: action,
      text: 'Browser preview mode: AI calls are available in the packaged Mac app after you add an OpenAI API key.',
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
  assistantText: '',
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
  brandToggleButton: document.querySelector('#brandToggleButton'),
  newArticleButton: document.querySelector('#newArticleButton'),
  chooseCoverButton: document.querySelector('#chooseCoverButton'),
  toggleDraftsButton: document.querySelector('#toggleDraftsButton'),
  jumpAssistantButton: document.querySelector('#jumpAssistantButton'),
  toggleInspectorButton: document.querySelector('#toggleInspectorButton'),
  themeButton: document.querySelector('#themeButton'),
  draftResizeHandle: document.querySelector('#draftResizeHandle'),
  inspectorResizeHandle: document.querySelector('#inspectorResizeHandle'),
  draftCount: document.querySelector('#draftCount'),
  assistantNote: document.querySelector('#assistantNote'),
  assistantModelSelect: document.querySelector('#assistantModelSelect'),
  assistantOutput: document.querySelector('#assistantOutput'),
  insertAssistantButton: document.querySelector('#insertAssistantButton'),
  replaceAssistantButton: document.querySelector('#replaceAssistantButton'),
  wechatStatus: document.querySelector('#wechatStatus'),
  wechatLog: document.querySelector('#wechatLog'),
  draftMediaIdInput: document.querySelector('#draftMediaIdInput'),
  publishIdInput: document.querySelector('#publishIdInput'),
  articleIdInput: document.querySelector('#articleIdInput'),
  openaiApiKeyInput: document.querySelector('#openaiApiKeyInput'),
  wechatAppIdInput: document.querySelector('#wechatAppIdInput'),
  wechatAppSecretInput: document.querySelector('#wechatAppSecretInput'),
  settingsState: document.querySelector('#settingsState'),
  resetLayoutButton: document.querySelector('#resetLayoutButton'),
  settingsModal: document.querySelector('#settingsModal'),
  openSettingsButton: document.querySelector('#openSettingsButton'),
  closeSettingsButton: document.querySelector('#closeSettingsButton'),
  openChatGptButton: document.querySelector('#openChatGptButton')
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

function setBrandIconVisible(visible) {
  const mark = elements.brandToggleButton.querySelector('.brand-mark');
  const icon = elements.brandToggleButton.querySelector('.rail-collapse-icon');
  mark.style.opacity = visible ? '0' : '';
  mark.style.transform = visible ? 'scale(0.78)' : '';
  icon.style.opacity = visible ? '1' : '';
  icon.style.transform = visible ? 'scale(1)' : '';
}

function syncBrandToggleVisual() {
  setBrandIconVisible(state.layout.draftsHidden);
}

function applyLayout() {
  const root = document.documentElement;
  root.style.setProperty('--drawer-width', `${state.layout.drawerWidth}px`);
  root.style.setProperty('--inspector-width', `${state.layout.inspectorWidth}px`);

  document.body.dataset.theme = state.layout.theme;
  document.body.classList.toggle('drafts-hidden', state.layout.draftsHidden);
  document.body.classList.toggle('inspector-hidden', state.layout.inspectorHidden);
  elements.brandToggleButton.classList.toggle('is-drawer-hidden', state.layout.draftsHidden);
  syncBrandToggleVisual();

  elements.themeButton.title = state.layout.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  setButtonLabel(elements.brandToggleButton, state.layout.draftsHidden ? 'Show drafts' : 'Hide drafts');
  setButtonLabel(elements.toggleDraftsButton, state.layout.draftsHidden ? 'Show drafts' : 'Drafts');
  setButtonLabel(elements.toggleInspectorButton, state.layout.inspectorHidden ? 'Show panel' : 'Hide panel');
  syncRailState();
}

function activeArticle() {
  return state.articles.find((article) => article.id === state.activeId) || state.articles[0];
}

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
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
  const article = activeArticle() || {
    id: `draft_${Date.now()}`,
    title: '',
    author: '',
    digest: '',
    sourceUrl: '',
    coverPath: '',
    showCover: true,
    openComment: false,
    contentMarkdown: '',
    wechat: {}
  };
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
  for (const article of state.articles) {
    const button = document.createElement('button');
    button.className = `article-item ${article.id === state.activeId ? 'active' : ''}`;
    button.innerHTML = `
      <span class="article-title">${escapeHtml(article.title || 'Untitled Article')}</span>
      <span class="article-meta">${escapeHtml(article.digest || article.updatedAt || '')}</span>
    `;
    button.addEventListener('click', async () => {
      await saveCurrentArticle({ quiet: true });
      state.activeId = article.id;
      render();
    });
    elements.articleList.appendChild(button);
  }
}

function renderEditor() {
  const article = activeArticle();
  if (!article) return;

  elements.titleInput.value = article.title || '';
  elements.authorInput.value = article.author || '';
  elements.digestInput.value = article.digest || '';
  elements.sourceUrlInput.value = article.sourceUrl || '';
  elements.coverPathInput.value = article.coverPath || '';
  elements.showCoverInput.checked = article.showCover !== false;
  elements.openCommentInput.checked = Boolean(article.openComment);
  elements.contentInput.value = article.contentMarkdown || '';

  elements.draftMediaIdInput.value = article.wechat?.draftMediaId || '';
  elements.publishIdInput.value = article.wechat?.publishId || '';
  elements.articleIdInput.value = article.wechat?.articleId || '';
  renderPreview();
}

function renderPreview() {
  const article = getEditorArticle();
  const html = markdownToHtml(article.contentMarkdown);
  elements.preview.innerHTML = `
    <h1>${escapeHtml(article.title || 'Untitled Article')}</h1>
    ${article.digest ? `<blockquote>${escapeHtml(article.digest)}</blockquote>` : ''}
    ${html}
  `;
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
  renderSettings();
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
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

elements.brandToggleButton.addEventListener('pointerenter', () => setBrandIconVisible(true));
elements.brandToggleButton.addEventListener('pointerleave', syncBrandToggleVisual);
elements.brandToggleButton.addEventListener('mouseenter', () => setBrandIconVisible(true));
elements.brandToggleButton.addEventListener('mouseleave', syncBrandToggleVisual);
elements.brandToggleButton.addEventListener('focus', () => setBrandIconVisible(true));
elements.brandToggleButton.addEventListener('blur', syncBrandToggleVisual);

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

elements.brandToggleButton.addEventListener('click', toggleDrafts);
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

elements.chooseCoverButton.addEventListener('click', async () => {
  const filePath = await bridge.chooseImage();
  if (filePath) {
    elements.coverPathInput.value = filePath;
    await saveCurrentArticle({ quiet: true });
  }
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

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const article = await saveCurrentArticle({ quiet: true });
    const selection = elements.contentInput.value.slice(
      elements.contentInput.selectionStart,
      elements.contentInput.selectionEnd
    );
    setBusy(button, true, 'Working');
    elements.assistantOutput.textContent = '';
    try {
      const result = await bridge.runAssistant({
        action: button.dataset.action,
        article,
        selection,
        note: elements.assistantNote.value.trim()
      });
      state.assistantText = result.text;
      elements.assistantOutput.textContent = result.text;
    } catch (error) {
      state.assistantText = '';
      elements.assistantOutput.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  });
});

elements.insertAssistantButton.addEventListener('click', () => {
  if (!state.assistantText) return;
  const start = elements.contentInput.selectionStart;
  const end = elements.contentInput.selectionEnd;
  const value = elements.contentInput.value;
  elements.contentInput.value = `${value.slice(0, start)}${state.assistantText}${value.slice(end)}`;
  renderPreview();
});

elements.replaceAssistantButton.addEventListener('click', () => {
  if (!state.assistantText) return;
  elements.contentInput.value = state.assistantText;
  renderPreview();
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

elements.openChatGptButton.addEventListener('click', async () => {
  if (bridge.openChatGptLogin) {
    await bridge.openChatGptLogin();
  }
});

document.querySelector('#testWechatButton').addEventListener('click', async (event) => {
  setBusy(event.currentTarget, true, 'Testing');
  try {
    const result = await bridge.testWechat();
    elements.wechatStatus.textContent = `Connected: ${result.tokenPreview}`;
    setWechatLog(result);
  } catch (error) {
    elements.wechatStatus.textContent = 'Connection failed';
    setWechatLog(error.message);
  } finally {
    setBusy(event.currentTarget, false);
  }
});

document.querySelector('#createDraftButton').addEventListener('click', async (event) => {
  const article = await saveCurrentArticle({ quiet: true });
  setBusy(event.currentTarget, true, 'Sending');
  try {
    const response = await bridge.createWechatDraft({
      article,
      htmlContent: markdownToHtml(article.contentMarkdown)
    });
    const index = state.articles.findIndex((item) => item.id === response.article.id);
    if (index >= 0) {
      state.articles[index] = response.article;
    }
    elements.draftMediaIdInput.value = response.result.mediaId;
    setWechatLog(response.result);
  } catch (error) {
    setWechatLog(error.message);
  } finally {
    setBusy(event.currentTarget, false);
  }
});

document.querySelector('#publishButton').addEventListener('click', async (event) => {
  const article = activeArticle();
  const mediaId = elements.draftMediaIdInput.value || article?.wechat?.draftMediaId;
  if (!mediaId) {
    setWechatLog('Missing draft media_id.');
    return;
  }
  if (!window.confirm('Submit this draft to the WeChat publishing flow?')) return;
  setBusy(event.currentTarget, true, 'Submitting');
  try {
    const result = await bridge.publishWechatDraft({ articleId: article.id, mediaId });
    elements.publishIdInput.value = result.publishId;
    setWechatLog(result);
  } catch (error) {
    setWechatLog(error.message);
  } finally {
    setBusy(event.currentTarget, false);
  }
});

document.querySelector('#statusButton').addEventListener('click', async (event) => {
  const article = activeArticle();
  const publishId = elements.publishIdInput.value || article?.wechat?.publishId;
  if (!publishId) {
    setWechatLog('Missing publish_id.');
    return;
  }
  setBusy(event.currentTarget, true, 'Checking');
  try {
    const result = await bridge.getWechatStatus({ articleId: article.id, publishId });
    if (result.article_id) {
      elements.articleIdInput.value = result.article_id;
    }
    setWechatLog(result);
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
