const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

const ACTIONS = {
  outline: {
    label: '提纲',
    instruction:
      '为这篇公众号文章生成清晰、有张力、适合中文读者阅读的结构提纲。输出标题建议、核心观点、分节提纲和结尾方式。'
  },
  titles: {
    label: '标题',
    instruction:
      '基于文章主题生成 12 个微信公众号标题，分成克制型、观点型、故事型、转发友好型四类。避免夸张和低质标题党。'
  },
  rewrite: {
    label: '改写',
    instruction:
      '改写正文，使表达更清晰、更有节奏、更适合微信公众号阅读。保留事实和作者立场，不添加未给出的事实。'
  },
  summary: {
    label: '摘要',
    instruction:
      '生成适合作为微信公众号摘要的文字。控制在 80 个中文字以内，明确、有吸引力，不过度营销。'
  },
  review: {
    label: '审稿',
    instruction:
      '像资深编辑一样审稿。指出结构、逻辑、事实表述、冗余、标题、摘要、结尾和潜在平台风险。给出可执行修改建议。'
  },
  format: {
    label: '排版',
    instruction:
      '把正文整理成适合微信公众号后台粘贴的 HTML。使用简洁段落、二级标题、强调文字和引用块，不使用外部 CSS。'
  }
};

function extractOutputText(payload) {
  if (payload.output_text) {
    return payload.output_text;
  }

  const chunks = [];
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) {
        chunks.push(part.text);
      }
      if (part.type === 'text' && part.text) {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

async function runWritingAssistant({ apiKey, model, action, article, selection, note }) {
  if (!apiKey) {
    throw new Error('缺少 OpenAI API Key。请先在设置中填写。');
  }

  const actionConfig = ACTIONS[action] || ACTIONS.review;
  const targetText = selection?.trim() || article.contentMarkdown || '';
  const userPrompt = [
    `任务：${actionConfig.instruction}`,
    '',
    `文章标题：${article.title || '未命名文章'}`,
    `作者：${article.author || '未填写'}`,
    `摘要：${article.digest || '未填写'}`,
    note ? `补充要求：${note}` : '',
    '',
    '正文：',
    targetText || '（正文为空，请基于标题和摘要给出建议。）'
  ]
    .filter(Boolean)
    .join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      instructions:
        '你是一个中文微信公众号写作编辑。输出要直接可用，保持事实谨慎，不编造来源，不替用户做最终发布决定。',
      input: userPrompt,
      max_output_tokens: 2400
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI 请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  const text = extractOutputText(payload);
  if (!text) {
    throw new Error('OpenAI 返回为空。');
  }

  return {
    action,
    label: actionConfig.label,
    text,
    model: model || DEFAULT_MODEL
  };
}

module.exports = {
  ACTIONS,
  DEFAULT_MODEL,
  runWritingAssistant
};
