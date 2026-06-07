const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

const ACTIONS = {
  balanced: {
    label: 'Balanced',
    instruction:
      'Respond to the user request with balanced editorial judgment. If the request is broad, choose the most useful writing move across outlining, rewriting, title work, digest polish, structure review, and formatting. Keep the answer directly usable for the current draft.'
  },
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
const MAX_ATTACHMENT_CHARS = 18_000;

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

function formatAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return '';
  }

  let remaining = MAX_ATTACHMENT_CHARS;
  const parts = [];

  for (const attachment of attachments.slice(0, 8)) {
    const label = `${attachment.name || 'Attachment'}${attachment.path ? ` (${attachment.path})` : ''}`;
    if (attachment.content && remaining > 0) {
      const content = attachment.content.slice(0, remaining);
      remaining -= content.length;
      parts.push(
        [
          `File: ${label}`,
          attachment.truncated ? 'Note: File was truncated before being added to the prompt.' : '',
          'Content:',
          content
        ]
          .filter(Boolean)
          .join('\n')
      );
      continue;
    }

    parts.push(`File: ${label}\nNote: ${attachment.status || 'Attached, but no readable text was available.'}`);
  }

  return parts.join('\n\n---\n\n');
}

async function runWritingAssistant({
  apiKey,
  model,
  action,
  article,
  selection,
  note,
  attachments,
  smartEnabled = true,
  searchEnabled = false
}) {
  if (!apiKey) {
    throw new Error('Missing OpenAI API key. Add it in Settings first.');
  }

  const actionConfig = ACTIONS[action] || ACTIONS.balanced;
  const targetText = selection?.trim() || article.contentMarkdown || '';
  const attachmentContext = formatAttachments(attachments);
  const userPrompt = [
    `Task: ${actionConfig.instruction}`,
    smartEnabled
      ? 'Smart mode: infer whether the user needs planning, editing, critique, title help, digest help, or formatting, then choose the best response shape.'
      : '',
    searchEnabled
      ? 'Search mode: use the attached files and draft context as the searchable source set. Do not claim live web browsing or external source checks unless the source text is provided.'
      : '',
    '',
    `Article title: ${article.title || 'Untitled Article'}`,
    `Author: ${article.author || 'Not provided'}`,
    `Digest: ${article.digest || 'Not provided'}`,
    note ? `Extra instructions: ${note}` : '',
    attachmentContext ? `\nAttached context:\n${attachmentContext}` : '',
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
