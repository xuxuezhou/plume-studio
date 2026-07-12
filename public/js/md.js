/* Block model + Markdown conversion. Global: MD
 *
 * A document is an array of blocks. Text-bearing blocks store inline HTML
 * (whitelisted tags only) in `text`:
 *   p, h1, h2, h3, quote, ul, ol, todo, callout, toggle
 * Special blocks:
 *   divider {}, code {code, lang}, math {tex}, table {rows, header},
 *   image {src, alt, caption, title, source, date, place, layout, width,
 *          radius, border, shadow, bg}
 *   gallery {items: [{src, alt, caption}], layout}
 *   columns {cols: [{text}]}
 * Image `src` values starting with "img:" refer to the image library.
 */
const MD = (() => {
  let uidCounter = 0;
  const uid = (prefix = 'b') =>
    `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const escapeHtml = (value = '') =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

  const escapeAttr = escapeHtml;

  // ---------- blocks ----------

  const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'quote', 'ul', 'ol', 'todo', 'callout', 'toggle']);

  const block = (type, extra = {}) => ({ id: uid(), type, ...(TEXT_TYPES.has(type) ? { text: '' } : {}), ...extra });

  // ---------- inline sanitize ----------

  const INLINE_ALLOWED = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', MARK: 'mark', CODE: 'code', A: 'a', BR: 'br' };

  function sanitizeInline(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out.push(escapeHtml(child.nodeValue));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = INLINE_ALLOWED[child.tagName];
          if (tag === 'br') {
            out.push('<br>');
          } else if (tag === 'a') {
            const href = child.getAttribute('href') || '';
            if (/^(https?:|mailto:|#)/i.test(href)) {
              out.push(`<a href="${escapeAttr(href)}" target="_blank" rel="noopener">`);
              walk(child);
              out.push('</a>');
            } else {
              walk(child);
            }
          } else if (tag) {
            out.push(`<${tag}>`);
            walk(child);
            out.push(`</${tag}>`);
          } else {
            walk(child);
          }
        }
      }
    };
    walk(template.content);
    return out.join('');
  }

  // ---------- inline markdown -> html ----------

  function inlineToHtml(text = '') {
    let html = escapeHtml(text);
    // code spans first so other markers inside them survive
    html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    html = html.replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    html = html.replace(/__([^_]+)__/g, '<b>$1</b>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    return html;
  }

  // ---------- inline html -> markdown ----------

  function htmlToInlineMd(html = '') {
    const template = document.createElement('template');
    template.innerHTML = html;
    const walk = (node) => {
      let out = '';
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const inner = walk(child);
          switch (child.tagName) {
            case 'B': case 'STRONG': out += inner ? `**${inner}**` : ''; break;
            case 'I': case 'EM': out += inner ? `*${inner}*` : ''; break;
            case 'S': case 'STRIKE': case 'DEL': out += inner ? `~~${inner}~~` : ''; break;
            case 'MARK': out += inner ? `==${inner}==` : ''; break;
            case 'U': out += inner ? `<u>${inner}</u>` : ''; break;
            case 'CODE': out += inner ? `\`${inner}\`` : ''; break;
            case 'A': out += inner ? `[${inner}](${child.getAttribute('href') || ''})` : ''; break;
            case 'BR': out += '\n'; break;
            default: out += inner;
          }
        }
      }
      return out;
    };
    return walk(template.content);
  }

  const plainText = (html = '') => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.textContent || '';
  };

  // ---------- markdown -> blocks ----------

  const CALLOUT_VARIANTS = ['info', 'tip', 'warning', 'danger', 'note'];

  function parse(markdown = '') {
    const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;

    const flushParagraph = (buffer) => {
      const text = buffer.join('\n').trim();
      if (text) blocks.push(block('p', { text: inlineToHtml(text).replaceAll('\n', '<br>') }));
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) { i++; continue; }

      // code fence
      let match = trimmed.match(/^```(\S*)/);
      if (match) {
        const lang = match[1] || '';
        const buffer = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) buffer.push(lines[i++]);
        i++;
        blocks.push(block('code', { code: buffer.join('\n'), lang }));
        continue;
      }

      // math fence
      if (trimmed === '$$') {
        const buffer = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '$$') buffer.push(lines[i++]);
        i++;
        blocks.push(block('math', { tex: buffer.join('\n').trim() }));
        continue;
      }
      match = trimmed.match(/^\$\$(.+)\$\$$/);
      if (match) { blocks.push(block('math', { tex: match[1].trim() })); i++; continue; }

      // divider
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push(block('divider')); i++; continue; }

      // headings
      match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = Math.min(match[1].length, 3);
        blocks.push(block(`h${level}`, { text: inlineToHtml(match[2]) }));
        i++; continue;
      }

      // callout / quote
      if (trimmed.startsWith('>')) {
        const buffer = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          buffer.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        const first = buffer[0] || '';
        const calloutMatch = first.match(/^\[!(\w+)\]\s*(.*)$/);
        if (calloutMatch && CALLOUT_VARIANTS.includes(calloutMatch[1].toLowerCase())) {
          const rest = [calloutMatch[2], ...buffer.slice(1)].filter(Boolean).join('\n');
          blocks.push(block('callout', { variant: calloutMatch[1].toLowerCase(), text: inlineToHtml(rest).replaceAll('\n', '<br>') }));
        } else {
          blocks.push(block('quote', { text: inlineToHtml(buffer.join('\n')).replaceAll('\n', '<br>') }));
        }
        continue;
      }

      // list items (one block per item)
      match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
      if (match) {
        blocks.push(block('todo', { text: inlineToHtml(match[2]), checked: match[1] !== ' ' }));
        i++; continue;
      }
      match = line.match(/^\s*[-*+]\s+(.*)$/);
      if (match) { blocks.push(block('ul', { text: inlineToHtml(match[1]) })); i++; continue; }
      match = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (match) { blocks.push(block('ol', { text: inlineToHtml(match[1]) })); i++; continue; }

      // table
      if (trimmed.startsWith('|') && lines[i + 1] && /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) && lines[i + 1].includes('-')) {
        const rows = [];
        const parseRow = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => inlineToHtml(cell.trim()));
        rows.push(parseRow(trimmed));
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(parseRow(lines[i++].trim()));
        blocks.push(block('table', { rows, header: true }));
        continue;
      }

      // standalone image
      match = trimmed.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/);
      if (match) {
        blocks.push(block('image', { src: match[2], alt: match[1] || '', title: match[3] || '', caption: '', layout: 'center', width: 100 }));
        i++; continue;
      }

      // paragraph: gather soft-wrapped lines
      const buffer = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|```|\$\$|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i].trim()) && !/^(-{3,}|\*{3,})$/.test(lines[i].trim())) {
        buffer.push(lines[i]);
        i++;
      }
      flushParagraph(buffer);
    }
    return blocks;
  }

  // ---------- blocks -> markdown ----------

  function blocksToMarkdown(blocks = []) {
    const out = [];
    let olCounter = 0;
    for (const b of blocks) {
      if (b.type !== 'ol') olCounter = 0;
      const text = () => htmlToInlineMd(b.text || '');
      switch (b.type) {
        case 'p': out.push(text()); break;
        case 'h1': out.push(`# ${text()}`); break;
        case 'h2': out.push(`## ${text()}`); break;
        case 'h3': out.push(`### ${text()}`); break;
        case 'quote': out.push(text().split('\n').map((l) => `> ${l}`).join('\n')); break;
        case 'callout': out.push([`> [!${b.variant || 'info'}] ${text().split('\n')[0]}`, ...text().split('\n').slice(1).map((l) => `> ${l}`)].join('\n')); break;
        case 'ul': out.push(`- ${text()}`); break;
        case 'ol': olCounter++; out.push(`${olCounter}. ${text()}`); break;
        case 'todo': out.push(`- [${b.checked ? 'x' : ' '}] ${text()}`); break;
        case 'toggle': out.push(`<details>\n<summary>${escapeHtml(b.summary || '')}</summary>\n\n${text()}\n\n</details>`); break;
        case 'divider': out.push('---'); break;
        case 'code': out.push(`\`\`\`${b.lang || ''}\n${b.code || ''}\n\`\`\``); break;
        case 'math': out.push(`$$\n${b.tex || ''}\n$$`); break;
        case 'table': {
          const rows = (b.rows || []).map((row) => `| ${row.map((cell) => htmlToInlineMd(cell)).join(' | ')} |`);
          if (rows.length) rows.splice(1, 0, `| ${(b.rows[0] || []).map(() => '---').join(' | ')} |`);
          out.push(rows.join('\n'));
          break;
        }
        case 'image': {
          out.push(`![${b.alt || ''}](${b.src || ''}${b.title ? ` "${b.title}"` : ''})`);
          if (b.caption) out.push(`*${b.caption}*`);
          break;
        }
        case 'gallery': {
          for (const item of b.items || []) {
            out.push(`![${item.alt || ''}](${item.src || ''})`);
            if (item.caption) out.push(`*${item.caption}*`);
          }
          break;
        }
        case 'columns': out.push((b.cols || []).map((col) => htmlToInlineMd(col.text || '')).join('\n\n')); break;
        default: break;
      }
    }
    return out.join('\n\n');
  }

  // ---------- blocks -> reading html ----------

  // Self-contained stroke icons for callouts (also embedded in exported HTML).
  const CALLOUT_ICONS = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
    tip: '<path d="M9 17a6.5 6.5 0 1 1 6 0"/><path d="M9.5 17h5M10 20.5h4"/>',
    warning: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
    danger: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>',
    note: '<path d="M9 4h6l1 7 3 3H5l3-3z"/><path d="M12 14v6"/>'
  };

  const calloutIcon = (variant) =>
    `<span class="callout-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CALLOUT_ICONS[variant] || CALLOUT_ICONS.info}</svg></span>`;

  function imageFigure(b, resolveSrc, itemOverride) {
    const item = itemOverride || b;
    const src = resolveSrc(item.src || '');
    if (!src) return '';
    const styles = [];
    if (b.radius != null) styles.push(`border-radius:${b.radius}px`);
    if (b.border) styles.push('border:1px solid var(--reader-border, #e3ded4)');
    if (b.shadow) styles.push('box-shadow:0 10px 32px rgba(30,26,20,.14)');
    if (b.bg) styles.push(`background:${escapeAttr(b.bg)};padding:16px`);
    const captionParts = [];
    if (item.title) captionParts.push(`<span class="figcap-title">${escapeHtml(item.title)}</span>`);
    if (item.caption) captionParts.push(escapeHtml(item.caption));
    const metaBits = [item.place, item.date, item.source ? `来源:${item.source}` : ''].filter(Boolean).map(escapeHtml);
    if (metaBits.length) captionParts.push(`<span class="figcap-meta">${metaBits.join(' · ')}</span>`);
    return `<figure class="reader-figure layout-${b.layout || 'center'}"${b.width && b.width < 100 ? ` style="width:${b.width}%"` : ''}>
      <img src="${escapeAttr(src)}" alt="${escapeAttr(item.alt || '')}" style="${styles.join(';')}" loading="lazy">
      ${captionParts.length ? `<figcaption>${captionParts.join('<br>')}</figcaption>` : ''}
    </figure>`;
  }

  function blocksToHtml(blocks = [], { resolveSrc = (s) => s, headingIds = false, resolveWiki = null } = {}) {
    if (resolveWiki) {
      const linkify = (html) => String(html || '').replace(/\[\[([^\[\]\n]+)\]\]/g, (m, t) => {
        const href = resolveWiki(t.trim());
        return href
          ? `<a class="wikilink" href="${escapeAttr(href)}">${t.trim()}</a>`
          : `<span class="wikilink-missing" title="没有找到这篇文章">${t.trim()}</span>`;
      });
      blocks = blocks.map((b) => {
        const copy = { ...b };
        if (copy.text) copy.text = linkify(copy.text);
        if (copy.cols) copy.cols = copy.cols.map((c) => ({ ...c, text: linkify(c.text) }));
        if (copy.rows) copy.rows = copy.rows.map((row) => row.map(linkify));
        return copy;
      });
    }
    const out = [];
    let list = null; // {tag, items}
    let headingIndex = 0;
    const closeList = () => {
      if (!list) return;
      out.push(`<${list.tag}${list.cls ? ` class="${list.cls}"` : ''}>${list.items.join('')}</${list.tag}>`);
      list = null;
    };
    const align = (b) => (b.align && b.align !== 'left' ? ` style="text-align:${b.align}"` : '');

    for (const b of blocks) {
      const listTag = b.type === 'ul' ? 'ul' : b.type === 'ol' ? 'ol' : b.type === 'todo' ? 'ul' : null;
      if (listTag) {
        const cls = b.type === 'todo' ? 'todo-list' : '';
        if (!list || list.tag !== listTag || list.cls !== cls) { closeList(); list = { tag: listTag, cls, items: [] }; }
        list.items.push(b.type === 'todo'
          ? `<li class="todo-item${b.checked ? ' done' : ''}"><span class="todo-box">${b.checked ? '✓' : ''}</span><span>${b.text || ''}</span></li>`
          : `<li>${b.text || ''}</li>`);
        continue;
      }
      closeList();
      switch (b.type) {
        case 'p': out.push(`<p${align(b)}>${b.text || '<br>'}</p>`); break;
        case 'h1': case 'h2': case 'h3': {
          headingIndex++;
          const id = headingIds ? ` id="h-${headingIndex}"` : '';
          out.push(`<${b.type}${id}${align(b)}>${b.text || ''}</${b.type}>`);
          break;
        }
        case 'quote': out.push(`<blockquote>${b.text || ''}</blockquote>`); break;
        case 'callout': out.push(`<div class="callout callout-${b.variant || 'info'}">${calloutIcon(b.variant)}<div class="callout-body">${b.text || ''}</div></div>`); break;
        case 'toggle': out.push(`<details class="reader-toggle"><summary>${escapeHtml(b.summary || '详情')}</summary><div>${b.text || ''}</div></details>`); break;
        case 'divider': out.push('<hr>'); break;
        case 'code': out.push(`<pre class="reader-code"><code>${escapeHtml(b.code || '')}</code></pre>`); break;
        case 'math': out.push(`<div class="reader-math">${escapeHtml(b.tex || '')}</div>`); break;
        case 'table': {
          const rows = b.rows || [];
          const head = b.header && rows.length ? `<thead><tr>${rows[0].map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>` : '';
          const bodyRows = b.header ? rows.slice(1) : rows;
          out.push(`<div class="reader-table-wrap"><table>${head}<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
          break;
        }
        case 'image': out.push(imageFigure(b, resolveSrc)); break;
        case 'gallery': {
          const layout = b.layout || 'grid2';
          const items = (b.items || []).map((item) => {
            const src = resolveSrc(item.src || '');
            return `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(item.alt || '')}" loading="lazy">${item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : ''}</figure>`;
          });
          out.push(`<div class="reader-gallery gallery-${layout}">${items.join('')}</div>`);
          break;
        }
        case 'columns': {
          out.push(`<div class="reader-columns">${(b.cols || []).map((col) => `<div>${col.text || ''}</div>`).join('')}</div>`);
          break;
        }
        default: break;
      }
    }
    closeList();
    return out.join('\n');
  }

  // ---------- outline / text / stats ----------

  function outline(blocks = []) {
    const items = [];
    let headingIndex = 0;
    for (const b of blocks) {
      if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
        headingIndex++;
        items.push({ level: Number(b.type[1]), text: plainText(b.text || ''), anchor: `h-${headingIndex}`, blockId: b.id });
      }
    }
    return items;
  }

  function textOf(blocks = []) {
    return blocks
      .map((b) => {
        if (b.text) return plainText(b.text);
        if (b.type === 'code') return b.code || '';
        if (b.type === 'math') return b.tex || '';
        if (b.type === 'toggle') return `${b.summary || ''} ${plainText(b.text || '')}`;
        if (b.type === 'table') return (b.rows || []).flat().map(plainText).join(' ');
        if (b.type === 'columns') return (b.cols || []).map((col) => plainText(col.text || '')).join(' ');
        if (b.type === 'image') return [b.title, b.caption].filter(Boolean).join(' ');
        if (b.type === 'gallery') return (b.items || []).map((item) => item.caption || '').join(' ');
        return '';
      })
      .join('\n');
  }

  function countWords(text = '') {
    const cjk = (text.match(/[一-鿿㐀-䶿぀-ヿ]/g) || []).length;
    const latin = (text.replace(/[一-鿿㐀-䶿぀-ヿ]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + latin;
  }

  function stats(blocks = []) {
    const text = textOf(blocks);
    const words = countWords(text);
    const chars = text.replace(/\s/g, '').length;
    const paragraphs = blocks.filter((b) => TEXT_TYPES.has(b.type) && plainText(b.text || '').trim()).length;
    const readMinutes = Math.max(1, Math.round(words / 420));
    return { words, chars, paragraphs, readMinutes };
  }

  return {
    uid, escapeHtml, escapeAttr, block, TEXT_TYPES,
    sanitizeInline, inlineToHtml, htmlToInlineMd, plainText,
    parse, blocksToMarkdown, blocksToHtml, outline, textOf, countWords, stats
  };
})();
