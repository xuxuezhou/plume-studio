const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

const ACTIONS = {
  outline: {
    label: 'Outline',
    instruction:
      'Create a clear, compelling structure for this WeChat Official Account article. Include title ideas, the core argument, section flow, and a strong ending.'
  },
  titles: {
    label: 'Titles',
    instruction:
      'Generate 12 WeChat Official Account title options grouped into restrained, opinion-led, story-led, and share-friendly styles. Avoid low-quality clickbait.'
  },
  rewrite: {
    label: 'Rewrite',
    instruction:
      'Rewrite the draft so it is clearer, tighter, and better paced for WeChat reading. Preserve facts and the author stance. Do not add unsupported claims.'
  },
  summary: {
    label: 'Digest',
    instruction:
      'Write a concise WeChat digest. Keep it direct, specific, and appealing without sounding overly promotional.'
  },
  review: {
    label: 'Review',
    instruction:
      'Review like a senior editor. Identify issues in structure, logic, factual wording, redundancy, title, digest, ending, and platform risk. Give actionable fixes.'
  },
  format: {
    label: 'Format',
    instruction:
      'Format the draft as clean HTML suitable for pasting into the WeChat editor. Use simple paragraphs, headings, emphasis, and quote blocks. Do not use external CSS.'
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
    throw new Error('Missing OpenAI API key. Add it in Settings first.');
  }

  const actionConfig = ACTIONS[action] || ACTIONS.review;
  const targetText = selection?.trim() || article.contentMarkdown || '';
  const userPrompt = [
    `Task: ${actionConfig.instruction}`,
    '',
    `Article title: ${article.title || 'Untitled Article'}`,
    `Author: ${article.author || 'Not provided'}`,
    `Digest: ${article.digest || 'Not provided'}`,
    note ? `Extra instructions: ${note}` : '',
    '',
    'Draft:',
    targetText || '(The draft is empty. Work from the title and digest.)'
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
        'You are a careful WeChat Official Account writing editor. Reply in the same language as the draft unless the user asks otherwise. Keep the output directly usable, be factual, do not invent sources, and never make the final publishing decision for the user.',
      input: userPrompt,
      max_output_tokens: 2400
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed: HTTP ${response.status}`;
    throw new Error(message);
  }

  const text = extractOutputText(payload);
  if (!text) {
    throw new Error('OpenAI returned an empty response.');
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
