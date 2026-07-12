/* Import / export. Global: Exporter
 * Export: Markdown, HTML, Word (.doc), TXT, PDF (print), long image (PNG),
 *         rich-text copy for pasting into WeChat/Zhihu/etc.
 * Import: .md / .txt / .html / .docx (minimal built-in zip+xml reader),
 *         clipboard paste, batch files.
 */
const Exporter = (() => {
  const slug = (s) => (s || '未命名').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 60);

  // Convert library refs / blob URLs to data URLs so exports are self-contained.
  async function resolveForExport(blocks) {
    const clone = JSON.parse(JSON.stringify(blocks || []));
    const toDataUrl = async (src) => {
      if (!src) return src;
      if (src.startsWith('img:')) {
        const img = Store.image(src.slice(4));
        return img?.blob ? UI.blobToDataUrl(img.blob) : '';
      }
      return src;
    };
    for (const b of clone) {
      if (b.type === 'image') b.src = await toDataUrl(b.src);
      if (b.type === 'gallery') for (const item of b.items || []) item.src = await toDataUrl(item.src);
    }
    return clone;
  }

  const EXPORT_CSS = `
    body{margin:0;padding:48px 24px;background:#faf9f6;color:#2b2823;font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
    .doc{max-width:720px;margin:0 auto;line-height:1.85;font-size:17px}
    h1{font-size:1.9em;line-height:1.3}h2{font-size:1.4em;margin-top:2em}h3{font-size:1.15em;margin-top:1.6em}
    blockquote{margin:1.2em 0;padding:2px 0 2px 16px;border-left:3px solid #c9c2b4;color:#6f695e}
    img{max-width:100%;border-radius:6px}figure{margin:1.6em 0;text-align:center}
    figcaption{font-size:.82em;color:#8a857c;margin-top:8px;line-height:1.6}
    pre{background:#f1eee7;border-radius:8px;padding:14px 16px;overflow-x:auto;font-size:.86em}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    table{border-collapse:collapse;width:100%;margin:1.4em 0}td,th{border:1px solid #e3ded4;padding:8px 12px;text-align:left}
    hr{border:none;border-top:1px solid #e3ded4;margin:2.4em auto;width:38%}
    .callout{display:flex;gap:10px;background:#f3f0e8;border:1px solid #e3ded4;border-radius:8px;padding:14px 16px;margin:1.4em 0}
    .callout-icon{flex:none;padding-top:3px;color:#6f695e}.callout-body{flex:1;min-width:0}
    .reader-gallery{display:grid;gap:10px;margin:1.6em 0}.gallery-grid2{grid-template-columns:1fr 1fr}.gallery-grid3,.gallery-grid{grid-template-columns:1fr 1fr 1fr}
    .reader-gallery figure{margin:0}.reader-columns{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:1.4em 0}
    .reader-math{text-align:center;font-family:Georgia,serif;font-style:italic;margin:1.6em 0;white-space:pre-wrap}
    .meta{color:#8a857c;font-size:.86em;margin-bottom:2em}.digest{color:#6f695e;font-style:italic}
    .todo-list{list-style:none;padding-left:4px}.todo-box{display:inline-block;width:1.1em;height:1.1em;border:1px solid #b9b2a4;border-radius:4px;margin-right:8px;font-size:.75em;text-align:center;line-height:1.1em;vertical-align:.05em}
    .todo-item.done{color:#8a857c;text-decoration:line-through}
    .toc{background:#f3f0e8;border-radius:8px;padding:16px 20px;margin-bottom:2em}.toc a{display:block;color:#2b2823;text-decoration:none;padding:2px 0}.toc .l2{padding-left:1em}.toc .l3{padding-left:2em}`;

  async function buildHtml(article, opts = {}) {
    const blocks = await resolveForExport(article.blocks);
    const coverUrl = article.cover ? Store.imageUrl(article.cover) : '';
    let coverData = '';
    if (opts.cover && coverUrl && article.cover?.startsWith('img:')) {
      const img = Store.image(article.cover.slice(4));
      coverData = img?.blob ? await UI.blobToDataUrl(img.blob) : '';
    } else if (opts.cover) {
      coverData = coverUrl;
    }
    const metaBits = [];
    if (opts.author && Store.state.settings.author) metaBits.push(UI.esc(Store.state.settings.author));
    if (opts.date) metaBits.push(UI.fmtDate(article.createdAt));
    if (opts.category && article.categoryId) metaBits.push(UI.esc(Store.categoryPath(article.categoryId)));
    if (opts.tags && article.tags?.length) metaBits.push(article.tags.map((t) => `#${UI.esc(t)}`).join(' '));

    const toc = opts.toc ? MD.outline(blocks) : [];
    const bodyHtml = MD.blocksToHtml(blocks, { resolveSrc: (s) => s, headingIds: true });
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${UI.esc(article.title || '未命名')}</title><style>${EXPORT_CSS}</style></head>
<body><div class="doc">
${coverData ? `<figure><img src="${coverData}" alt=""></figure>` : ''}
<h1>${UI.esc(article.title || '未命名')}</h1>
${article.digest ? `<p class="digest">${UI.esc(article.digest)}</p>` : ''}
${metaBits.length ? `<p class="meta">${metaBits.join(' · ')}</p>` : ''}
${toc.length >= 2 ? `<nav class="toc"><b>目录</b>${toc.map((h) => `<a class="l${h.level}" href="#${h.anchor}">${UI.esc(h.text)}</a>`).join('')}</nav>` : ''}
${bodyHtml}
${opts.footer ? `<hr><p class="meta">${UI.esc(opts.footer)}</p>` : ''}
</div></body></html>`;
  }

  function stripCaptions(blocks, keep) {
    if (keep) return blocks;
    return blocks.map((b) => {
      if (b.type === 'image') return { ...b, caption: '', title: '', source: '', date: '', place: '' };
      if (b.type === 'gallery') return { ...b, items: (b.items || []).map((i) => ({ ...i, caption: '' })) };
      return b;
    });
  }

  // ---------- export dialog ----------

  function exportDialog(articleId) {
    const article = Store.article(articleId);
    if (!article) return;
    const body = UI.el(`<div class="export-dialog">
      <div class="form-label">格式</div>
      <div class="export-formats">
        ${[['md', 'Markdown', '.md 纯文本,通用迁移'], ['html', 'HTML', '独立网页文件'], ['pdf', 'PDF', '通过打印生成'], ['doc', 'Word', '.doc 文档'], ['txt', '纯文本', '.txt 无格式'], ['png', '图片长图', '整篇文章一张长图']]
          .map(([id, name, hint], i) => `<label class="export-format"><input type="radio" name="fmt" value="${id}" ${i === 0 ? 'checked' : ''}><b>${name}</b><span>${hint}</span></label>`).join('')}
      </div>
      <div class="form-label" style="margin-top:14px">包含内容</div>
      <div class="export-opts">
        <label class="check-row"><input type="checkbox" data-o="cover" checked> 封面</label>
        <label class="check-row"><input type="checkbox" data-o="author" checked> 作者信息</label>
        <label class="check-row"><input type="checkbox" data-o="date" checked> 创建日期</label>
        <label class="check-row"><input type="checkbox" data-o="category"> 分类</label>
        <label class="check-row"><input type="checkbox" data-o="tags"> 标签</label>
        <label class="check-row"><input type="checkbox" data-o="captions" checked> 图片说明</label>
        <label class="check-row"><input type="checkbox" data-o="toc"> 目录</label>
        <label class="check-row"><input type="checkbox" data-o="pagefoot"> 页脚(作者 + 日期)</label>
      </div>
    </div>`);
    UI.modal({
      title: `导出「${article.title || '未命名'}」`, body, width: 480,
      footer: [
        { label: '取消' },
        { label: '导出', kind: 'btn-primary', onClick: () => {
          const fmt = body.querySelector('input[name="fmt"]:checked').value;
          const opts = {};
          body.querySelectorAll('[data-o]').forEach((el) => { opts[el.dataset.o] = el.checked; });
          runExport(article, fmt, opts).catch((err) => UI.toast(`导出失败:${err.message}`, 'error'));
        } }
      ]
    });
  }

  async function runExport(article, fmt, opts) {
    const name = slug(article.title);
    const withCaptions = { ...article, blocks: stripCaptions(article.blocks, opts.captions) };
    const htmlOpts = { ...opts, footer: opts.pagefoot ? `${Store.state.settings.author || ''} ${UI.fmtDate(article.createdAt)}`.trim() : '' };

    if (fmt === 'md') {
      const blocks = await resolveForExport(withCaptions.blocks);
      const head = [`# ${article.title || '未命名'}`];
      if (opts.date || opts.author || opts.category || opts.tags) {
        const meta = [];
        if (opts.author && Store.state.settings.author) meta.push(`作者:${Store.state.settings.author}`);
        if (opts.date) meta.push(`日期:${UI.fmtDate(article.createdAt)}`);
        if (opts.category && article.categoryId) meta.push(`分类:${Store.categoryPath(article.categoryId)}`);
        if (opts.tags && article.tags?.length) meta.push(`标签:${article.tags.join(', ')}`);
        if (meta.length) head.push(`> ${meta.join(' · ')}`);
      }
      if (article.digest) head.push(`> ${article.digest}`);
      UI.download(`${name}.md`, `${head.join('\n\n')}\n\n${MD.blocksToMarkdown(blocks)}\n`, 'text/markdown;charset=utf-8');
    }

    if (fmt === 'txt') {
      const text = `${article.title || '未命名'}\n\n${article.digest ? `${article.digest}\n\n` : ''}${MD.textOf(withCaptions.blocks)}\n`;
      UI.download(`${name}.txt`, text, 'text/plain;charset=utf-8');
    }

    if (fmt === 'html') {
      UI.download(`${name}.html`, await buildHtml(withCaptions, htmlOpts), 'text/html;charset=utf-8');
    }

    if (fmt === 'doc') {
      const html = await buildHtml(withCaptions, htmlOpts);
      UI.download(`${name}.doc`, `﻿${html}`, 'application/msword;charset=utf-8');
    }

    if (fmt === 'pdf') {
      const html = await buildHtml(withCaptions, htmlOpts);
      const win = window.open('', '_blank');
      if (!win) { UI.toast('浏览器拦截了新窗口,请允许弹窗后重试', 'error'); return; }
      win.document.write(html);
      win.document.close();
      win.addEventListener('load', () => setTimeout(() => win.print(), 300));
      UI.toast('在打印对话框中选择「存储为 PDF」');
    }

    if (fmt === 'png') {
      await exportLongImage(withCaptions, htmlOpts);
    }
    if (fmt !== 'pdf') UI.toast('导出完成', 'success');
  }

  // Render the article into an SVG foreignObject and rasterize to PNG.
  async function exportLongImage(article, opts) {
    const width = 800;
    const html = await buildHtml(article, opts);
    const bodyInner = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
    const css = EXPORT_CSS;

    // measure height off-screen
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;background:#faf9f6`;
    probe.innerHTML = `<style>${css}</style>${bodyInner}`;
    document.body.appendChild(probe);
    await new Promise((r) => setTimeout(r, 120));
    const height = Math.min(probe.scrollHeight + 60, 16000);
    probe.remove();

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#faf9f6">
          <style>${css}</style>${bodyInner}
        </div>
      </foreignObject></svg>`;
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('长图渲染失败,可尝试导出 PDF 代替'));
      img.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) UI.download(`${slug(article.title)}.png`, blob, 'image/png');
      else UI.toast('长图生成失败,可尝试导出 PDF 代替', 'error');
    }, 'image/png');
  }

  // Rich-text copy: paste into WeChat editor, Zhihu, Google Docs, etc.
  async function copyRich(articleId) {
    const article = Store.article(articleId);
    if (!article) return;
    const blocks = await resolveForExport(article.blocks);
    const html = `<h1>${UI.esc(article.title || '')}</h1>${MD.blocksToHtml(blocks, { resolveSrc: (s) => s })}`;
    const text = `${article.title}\n\n${MD.textOf(article.blocks)}`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })
      ]);
      UI.toast('已复制排版结果,可直接粘贴到公众号 / 知乎等编辑器', 'success');
    } catch {
      UI.toast('复制失败:浏览器不支持富文本剪贴板', 'error');
    }
  }

  // ---------- import ----------

  // Minimal zip reader (for .docx) built on DecompressionStream.
  async function readZipEntry(buffer, wantedName) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // locate End Of Central Directory
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65558); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('无法解析 docx 文件');
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      if (name === wantedName) {
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const compSize = view.getUint32(offset + 20, true);
        const start = localOffset + 30 + localNameLen + localExtraLen;
        const data = bytes.subarray(start, start + compSize);
        if (method === 0) return decoder.decode(data);
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([data]).stream().pipeThrough(ds);
        return await new Response(stream).text();
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('docx 中找不到正文');
  }

  async function docxToMarkdown(file) {
    const xml = await readZipEntry(await file.arrayBuffer(), 'word/document.xml');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const out = [];
    for (const p of doc.getElementsByTagNameNS(W, 'p')) {
      const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
      const style = styleEl?.getAttributeNS(W, 'val') || styleEl?.getAttribute('w:val') || '';
      let text = '';
      for (const r of p.getElementsByTagNameNS(W, 'r')) {
        let chunk = '';
        for (const t of r.getElementsByTagNameNS(W, 't')) chunk += t.textContent;
        const bold = r.getElementsByTagNameNS(W, 'b').length > 0;
        const italic = r.getElementsByTagNameNS(W, 'i').length > 0;
        if (chunk.trim()) {
          if (bold) chunk = `**${chunk}**`;
          if (italic) chunk = `*${chunk}*`;
        }
        text += chunk;
      }
      const numPr = p.getElementsByTagNameNS(W, 'numPr').length > 0;
      const headingMatch = style.match(/[Hh]eading(\d)/) || style.match(/^(\d)$/);
      if (headingMatch && text.trim()) out.push(`${'#'.repeat(Math.min(3, Number(headingMatch[1])))} ${text}`);
      else if (numPr && text.trim()) out.push(`- ${text}`);
      else out.push(text);
    }
    return out.join('\n\n');
  }

  function htmlToBlocks(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks = [];
    const pushText = (type, node, extra = {}) => {
      const text = MD.sanitizeInline(node.innerHTML);
      if (MD.plainText(text).trim() || type !== 'p') blocks.push(MD.block(type, { text, ...extra }));
    };
    const walk = (root) => {
      for (const node of root.children) {
        switch (node.tagName) {
          case 'H1': pushText('h1', node); break;
          case 'H2': pushText('h2', node); break;
          case 'H3': case 'H4': pushText('h3', node); break;
          case 'P': {
            const img = node.querySelector('img');
            if (img && !node.textContent.trim()) blocks.push(MD.block('image', { src: img.src, alt: img.alt || '', caption: '', title: '', layout: 'center', width: 100, radius: 6 }));
            else pushText('p', node);
            break;
          }
          case 'BLOCKQUOTE': pushText('quote', node); break;
          case 'PRE': blocks.push(MD.block('code', { code: node.textContent, lang: '' })); break;
          case 'HR': blocks.push(MD.block('divider')); break;
          case 'IMG': blocks.push(MD.block('image', { src: node.src, alt: node.alt || '', caption: '', title: '', layout: 'center', width: 100, radius: 6 })); break;
          case 'UL': for (const li of node.querySelectorAll(':scope > li')) pushText('ul', li); break;
          case 'OL': for (const li of node.querySelectorAll(':scope > li')) pushText('ol', li); break;
          case 'TABLE': {
            const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((cell) => MD.sanitizeInline(cell.innerHTML)));
            if (rows.length) blocks.push(MD.block('table', { rows, header: node.querySelector('th') != null }));
            break;
          }
          case 'DIV': case 'ARTICLE': case 'SECTION': case 'MAIN': case 'BODY': walk(node); break;
          default: if (node.textContent.trim()) pushText('p', node);
        }
      }
    };
    walk(doc.body);
    return blocks.length ? blocks : [MD.block('p')];
  }

  async function fileToArticle(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const title = file.name.replace(/\.[^.]+$/, '');
    let blocks;
    if (ext === 'docx') blocks = MD.parse(await docxToMarkdown(file));
    else if (ext === 'html' || ext === 'htm') blocks = htmlToBlocks(await UI.readAsText(file));
    else blocks = MD.parse(await UI.readAsText(file));
    // lift a leading h1 into the title
    let realTitle = title;
    if (blocks[0]?.type === 'h1') realTitle = MD.plainText(blocks.shift().text) || title;
    if (!blocks.length) blocks = [MD.block('p')];
    return Store.createArticle({ title: realTitle, blocks, status: 'draft' });
  }

  function importDialog() {
    const body = UI.el(`<div class="import-dialog">
      <button class="import-drop" data-i="files">
        ${UI.icon('upload', 22)}
        <b>选择文件或拖拽到这里</b>
        <span class="hint">支持 Markdown、TXT、HTML、Word (.docx),可一次选择多个文件批量导入</span>
      </button>
      <div class="form-label" style="margin-top:14px">或从剪贴板粘贴</div>
      <textarea class="input" rows="6" placeholder="把 Markdown 或纯文本粘贴到这里…"></textarea>
    </div>`);
    const drop = body.querySelector('.import-drop');
    const textarea = body.querySelector('textarea');

    const importFiles = async (files) => {
      let ok = 0;
      for (const f of files) {
        try { await fileToArticle(f); ok++; }
        catch (err) { UI.toast(`${f.name}:${err.message}`, 'error'); }
      }
      if (ok) { UI.toast(`已导入 ${ok} 篇文章`, 'success'); m.close(); }
    };

    drop.addEventListener('click', async () => importFiles(await UI.pickFiles('.md,.markdown,.txt,.html,.htm,.docx', true)));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); importFiles([...e.dataTransfer.files]); });

    const m = UI.modal({
      title: '导入文章', body, width: 520,
      footer: [
        { label: '取消' },
        { label: '导入粘贴内容', kind: 'btn-primary', onClick: async () => {
          const text = textarea.value.trim();
          if (!text) return false;
          const blocks = MD.parse(text);
          let title = '导入的文章';
          if (blocks[0]?.type === 'h1') title = MD.plainText(blocks.shift().text) || title;
          const a = await Store.createArticle({ title, blocks: blocks.length ? blocks : [MD.block('p')], status: 'draft' });
          UI.toast('已导入', 'success');
          location.hash = `#/edit/${a.id}`;
        } }
      ]
    });
  }

  return { exportDialog, copyRich, importDialog, fileToArticle, buildHtml };
})();
