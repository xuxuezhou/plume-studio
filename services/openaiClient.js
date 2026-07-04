const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MAX_ATTACHMENT_CHARS = 18_000;
const MAX_HISTORY_MESSAGES = 20;

const ACTIONS = {
  assist: {
    label: 'Assist',
    instruction:
      'Respond to the user request with balanced editorial judgment. If the request is broad, choose the most useful writing move across outlining, rewriting, title work, digest polish, structure review, and formatting. Keep the answer directly usable for the current draft.'
  },
  outline: {
    label: 'Outline',
    instruction:
      'Design a clear, compelling structure for this WeChat Official Account article: title directions, the core argument, section flow, and a strong ending.'
  },
  titles: {
    label: 'Titles',
    instruction:
      'Generate 12 title options for this article, grouped into restrained, opinion-led, story-led, and share-friendly styles. Avoid low-quality clickbait.'
  },
  rewrite: {
    label: 'Rewrite',
    instruction:
      'Rewrite the draft so it is clearer, tighter, and better paced for mobile reading. Preserve facts and the author stance; do not add unsupported claims. Output the full rewritten text directly.'
  },
  summary: {
    label: 'Digest',
    instruction:
      'Write a concise article digest (under 120 characters). Keep it direct, specific, and appealing without sounding overly promotional.'
  },
  review: {
    label: 'Review',
    instruction:
      'Review like a senior editor: point out issues in structure, logic, factual wording, redundancy, title, digest, ending, and platform risk, and give actionable fixes.'
  }
};

function buildSystemPrompt(article, selection) {
  const parts = [
    'You are a careful writing editor for WeChat Official Account articles, helping the user polish the current draft.',
    'Reply in the same language as the draft unless the user asks otherwise. Keep the output directly usable, stay factual, never invent sources, and never make the final publishing decision for the user.',
    '',
    `Article title: ${article?.title || 'Untitled'}`,
    `Author: ${article?.author || 'Not provided'}`,
    `Digest: ${article?.digest || 'Not provided'}`
  ];

  const draft = article?.contentMarkdown || '';
  parts.push(
    '',
    'Current draft:',
    draft.trim() ? draft.slice(0, 24_000) : '(The draft is empty. Work from the title and digest.)'
  );

  if (selection?.trim()) {
    parts.push(
      '',
      'Text the user currently has selected (focus on this if they ask for edits):',
      selection.slice(0, 8_000)
    );
  }

  return parts.join('\n');
}

function formatAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';

  let remaining = MAX_ATTACHMENT_CHARS;
  const parts = [];
  for (const attachment of attachments.slice(0, 8)) {
    const label = attachment.name || 'Attachment';
    if (attachment.content && remaining > 0) {
      const content = String(attachment.content).slice(0, remaining);
      remaining -= content.length;
      parts.push(`File: ${label}${attachment.truncated ? ' (truncated)' : ''}\nContent:\n${content}`);
    } else {
      parts.push(`File: ${label}\nNote: ${attachment.status || 'Attached, but no readable text was available.'}`);
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
    actionConfig ? `Task: ${actionConfig.instruction}` : '',
    note ? note : '',
    attachmentContext ? `\nReference material:\n${attachmentContext}` : ''
  ].filter(Boolean);

  messages.push({
    role: 'user',
    content: userParts.join('\n\n') || 'Give the most helpful writing advice for the current draft.'
  });

  return messages;
}

async function requestChatCompletion({ apiKey, baseUrl, model, messages, stream }) {
  if (!apiKey) {
    throw new Error('Missing OpenAI API key. Add it in Settings first.');
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
    const message = payload?.error?.message || `OpenAI request failed: HTTP ${response.status}`;
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
    throw new Error('OpenAI returned an empty response.');
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
