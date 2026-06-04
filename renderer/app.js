const bridge = window.writingDesk;

const state = {
  articles: [],
  settings: {},
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
  newArticleButton: document.querySelector('#newArticleButton'),
  chooseCoverButton: document.querySelector('#chooseCoverButton'),
  assistantNote: document.querySelector('#assistantNote'),
  assistantOutput: document.querySelector('#assistantOutput'),
  insertAssistantButton: document.querySelector('#insertAssistantButton'),
  replaceAssistantButton: document.querySelector('#replaceAssistantButton'),
  wechatStatus: document.querySelector('#wechatStatus'),
  wechatLog: document.querySelector('#wechatLog'),
  draftMediaIdInput: document.querySelector('#draftMediaIdInput'),
  publishIdInput: document.querySelector('#publishIdInput'),
  articleIdInput: document.querySelector('#articleIdInput'),
  openaiApiKeyInput: document.querySelector('#openaiApiKeyInput'),
  openaiModelInput: document.querySelector('#openaiModelInput'),
  wechatAppIdInput: document.querySelector('#wechatAppIdInput'),
  wechatAppSecretInput: document.querySelector('#wechatAppSecretInput'),
  settingsState: document.querySelector('#settingsState')
};

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
  const article = activeArticle();
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
  for (const article of state.articles) {
    const button = document.createElement('button');
    button.className = `article-item ${article.id === state.activeId ? 'active' : ''}`;
    button.innerHTML = `
      <span class="article-title">${escapeHtml(article.title || '未命名文章')}</span>
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
    <h1>${escapeHtml(article.title || '未命名文章')}</h1>
    ${article.digest ? `<blockquote>${escapeHtml(article.digest)}</blockquote>` : ''}
    ${html}
  `;
}

function renderSettings() {
  elements.openaiModelInput.value = state.settings.openaiModel || 'gpt-5.4-mini';
  elements.wechatAppIdInput.value = state.settings.wechatAppId || '';
  elements.settingsState.textContent = [
    `OpenAI Key：${state.settings.hasOpenaiApiKey ? '已保存' : '未保存'}`,
    `微信 AppSecret：${state.settings.hasWechatAppSecret ? '已保存' : '未保存'}`
  ].join('\n');
}

function render() {
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
      elements.saveButton.textContent = '已保存';
      window.setTimeout(() => {
        elements.saveButton.textContent = '保存';
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

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`#${tab.dataset.tab}Panel`).classList.add('active');
  });
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
  if (!window.confirm(`删除《${article.title || '未命名文章'}》？`)) return;
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
    setBusy(button, true, '处理中');
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
    openaiModel: elements.openaiModelInput.value.trim(),
    wechatAppId: elements.wechatAppIdInput.value.trim(),
    wechatAppSecret: elements.wechatAppSecretInput.value.trim()
  });
  state.settings = settings;
  elements.openaiApiKeyInput.value = '';
  elements.wechatAppSecretInput.value = '';
  renderSettings();
});

document.querySelector('#testWechatButton').addEventListener('click', async (event) => {
  setBusy(event.currentTarget, true, '测试中');
  try {
    const result = await bridge.testWechat();
    elements.wechatStatus.textContent = `已连接：${result.tokenPreview}`;
    setWechatLog(result);
  } catch (error) {
    elements.wechatStatus.textContent = '连接失败';
    setWechatLog(error.message);
  } finally {
    setBusy(event.currentTarget, false);
  }
});

document.querySelector('#createDraftButton').addEventListener('click', async (event) => {
  const article = await saveCurrentArticle({ quiet: true });
  setBusy(event.currentTarget, true, '推送中');
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
    setWechatLog('缺少 draft media_id。');
    return;
  }
  if (!window.confirm('确认提交发布？提交后会进入微信公众号发布流程。')) return;
  setBusy(event.currentTarget, true, '提交中');
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
    setWechatLog('缺少 publish_id。');
    return;
  }
  setBusy(event.currentTarget, true, '查询中');
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
});

load();
