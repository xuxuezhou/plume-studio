const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MAX_ATTACHMENT_CHARS = 18_000;
const MAX_HISTORY_MESSAGES = 20;

const ACTIONS = {
  assist: {
    label: '助手',
    instruction:
      '以均衡的编辑判断回应用户请求。如果请求较宽泛，请在大纲、改写、标题、摘要润色、结构审查和排版之间选择最有用的写作动作。回答要能直接用于当前草稿。'
  },
  outline: {
    label: '大纲',
    instruction:
      '为这篇公众号文章设计清晰有力的结构：给出标题方向、核心论点、章节流程和有力的结尾。'
  },
  titles: {
    label: '标题',
    instruction:
      '生成 12 个公众号标题选项，按克制型、观点型、故事型、易转发型分组。避免低质标题党。'
  },
  rewrite: {
    label: '改写',
    instruction:
      '改写草稿，使其更清晰、更紧凑、更适合公众号阅读节奏。保留事实与作者立场，不要添加没有依据的论断。直接输出改写后的全文。'
  },
  summary: {
    label: '摘要',
    instruction:
      '为这篇文章撰写简洁的公众号摘要（120 字以内），直接、具体、有吸引力，但不要过度营销。'
  },
  review: {
    label: '审稿',
    instruction:
      '像资深编辑一样审稿：指出结构、逻辑、事实表述、冗余、标题、摘要、结尾和平台风险方面的问题，并给出可执行的修改建议。'
  }
};

function buildSystemPrompt(article, selection) {
  const parts = [
    '你是一位严谨的微信公众号写作编辑，协助用户打磨当前草稿。',
    '除非用户另有要求，请使用与草稿相同的语言回复。输出要能直接使用，保持事实准确，不要虚构来源，也不要替用户做最终发布决定。',
    '',
    `文章标题：${article?.title || '未命名文章'}`,
    `作者：${article?.author || '未提供'}`,
    `摘要：${article?.digest || '未提供'}`
  ];

  const draft = article?.contentMarkdown || '';
  parts.push('', '当前草稿全文：', draft.trim() ? draft.slice(0, 24_000) : '（草稿为空，请根据标题与摘要开展工作。）');

  if (selection?.trim()) {
    parts.push('', '用户当前选中的文本（若用户要求修改，优先针对这段）：', selection.slice(0, 8_000));
  }

  return parts.join('\n');
}

function formatAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';

  let remaining = MAX_ATTACHMENT_CHARS;
  const parts = [];
  for (const attachment of attachments.slice(0, 8)) {
    const label = attachment.name || '附件';
    if (attachment.content && remaining > 0) {
      const content = String(attachment.content).slice(0, remaining);
      remaining -= content.length;
      parts.push(`文件：${label}${attachment.truncated ? '（已截断）' : ''}\n内容：\n${content}`);
    } else {
      parts.push(`文件：${label}\n说明：${attachment.status || '已附加，但没有可读取的文本。'}`);
    }
  }
  return parts.join('\n\n---\n\n');
}

function buildMessages({ article, selection, note, action, history, attachments }) {
  const messages = [{ role: 'system', content: buildSystemPrompt(article, selection) }];

  for (const message of (history || []).slice(-MAX_HISTORY_MESSAGES)) {
    if ((message.role === 'user' || message.role === 'assistant') && message.content) {
      messages.push({ role: message.role, content: String(message.content).slice(0, 12_000) });
    }
  }

  const actionConfig = action && action !== 'assist' ? ACTIONS[action] : null;
  const attachmentContext = formatAttachments(attachments);
  const userParts = [
    actionConfig ? `任务：${actionConfig.instruction}` : '',
    note ? note : '',
    attachmentContext ? `\n附加参考资料：\n${attachmentContext}` : ''
  ].filter(Boolean);

  messages.push({
    role: 'user',
    content: userParts.join('\n\n') || '请根据当前草稿给出最有帮助的写作建议。'
  });

  return messages;
}

async function requestChatCompletion({ apiKey, baseUrl, model, messages, stream }) {
  if (!apiKey) {
    throw new Error('缺少 OpenAI API Key，请先在设置中填写。');
  }

  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      stream: Boolean(stream)
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error?.message || `OpenAI 请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return response;
}

// Streams assistant output; calls onDelta(textChunk) as tokens arrive, resolves with the full text.
async function streamAssistant(options, onDelta) {
  const messages = buildMessages(options);
  const response = await requestChatCompletion({ ...options, messages, stream: true });

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          onDelta?.(delta);
        }
      } catch {
        // Ignore malformed keep-alive lines.
      }
    }
  }

  if (!fullText.trim()) {
    throw new Error('OpenAI 返回了空响应。');
  }
  return fullText;
}

async function testConnection({ apiKey, baseUrl, model }) {
  const response = await requestChatCompletion({
    apiKey,
    baseUrl,
    model,
    messages: [{ role: 'user', content: "Reply with the single word 'ok'." }],
    stream: false
  });
  const payload = await response.json();
  return {
    ok: true,
    model: payload.model || model || DEFAULT_MODEL,
    reply: payload.choices?.[0]?.message?.content?.trim() || ''
  };
}

module.exports = {
  ACTIONS,
  DEFAULT_MODEL,
  streamAssistant,
  testConnection
};
