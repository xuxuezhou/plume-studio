/* Shared UI primitives: icons, menus, modals, toasts, inputs. Global: UI */
const UI = (() => {
  // ---------- icons (feather-style, stroke = currentColor) ----------

  const PATHS = {
    home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
    files: '<path d="M8 7h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><path d="M17 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    inbox: '<path d="M4 4h16v16H4z"/><path d="M4 13h5a3 3 0 0 0 6 0h5"/>',
    star: '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.3-.8z"/>',
    starFill: '<path fill="currentColor" stroke="none" d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.3-.8z"/>',
    folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    tag: '<path d="m3 12 9-9h8a1 1 0 0 1 1 1v8l-9 9a1 1 0 0 1-1.4 0L3 13.4A1 1 0 0 1 3 12z"/><circle cx="16" cy="8" r="1.4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 19 5-5 3 3 3-4 3 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    grip: '<circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
    dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    pen: '<path d="M4 20h4L20 8a2.5 2.5 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 20h16"/>',
    template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
    focus: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
    pin: '<path d="M9 4h6l1 7 3 3H5l3-3z"/><path d="M12 14v6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    print: '<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="1"/><path d="M7 14h10v7H7z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/>',
    bookOpen: '<path d="M2 5h7a3 3 0 0 1 3 3 3 3 0 0 1 3-3h7v13h-7a3 3 0 0 0-3 3 3 3 0 0 0-3-3H2z"/><path d="M12 8v13"/>',
    type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 .4l3-3a4 4 0 1 0-5.7-5.6l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.7 5.6l1.2-1.2"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    quote: '<path d="M8 11H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4-4 4.5M19 11h-3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4-4 4.5"/>',
    code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
    heading: '<path d="M5 5v14M19 5v14M5 12h14"/>',
    listUl: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/>',
    divider: '<path d="M4 12h16"/><path d="M8 7h8M8 17h8" opacity=".35"/>',
    callout: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14" opacity=".5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2 2M15.5 15.5l2 2M6.5 17.5l2-2M15.5 8.5l2-2"/>',
    rotate: '<path d="M21 8a9 9 0 1 0 .5 5"/><path d="M21 3v5h-5"/>',
    crop: '<path d="M7 3v14a1 1 0 0 0 1 1h13"/><path d="M3 7h14a1 1 0 0 1 1 1v13"/>',
    external: '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    graph: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="9" r="2.4"/><circle cx="9" cy="18" r="2.4"/><path d="m8.2 7 7.5 1.4M7 8.2l1.4 7.5M16.4 10.8l-5.6 5.6"/>',
    feather: '<path d="M20 4c-5.5 0-11 3-13 9l-3 7 7-3c6-2.5 9-7.5 9-13z"/><path d="M16 8 6 18"/>',
    leaf: '<path d="M5 19C5 9 12 4 20 4c0 8-5 15-15 15z"/><path d="M5 19c3-6 7-9 11-11"/>',
    flask: '<path d="M10 3v6l-5.5 9a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M8 3h8M7.5 14h9"/>',
    notebook: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M13 8h4M13 12h4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    ruler: '<path d="m3 17 14-14 4 4L7 21z"/><path d="m8.5 8.5 1.5 1.5M11.5 5.5l1.5 1.5M5.5 11.5l1.5 1.5"/>',
    chart: '<path d="M4 20v-7M10 20V6M16 20v-10M4 20h17"/>',
    coffee: '<path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M16 9h2a2.5 2.5 0 0 1 0 5h-2M7 4v2M11 4v2"/>',
    mountain: '<path d="m3 19 6-11 4 7 3-4 5 8z"/><circle cx="17" cy="6" r="1.6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18-3-3-3-15 0-18z"/>',
    music: '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    heart: '<path d="M12 20 5 13a4.4 4.4 0 0 1 6.2-6.2l.8.8.8-.8A4.4 4.4 0 1 1 19 13z"/>',
    bulb: '<path d="M9 17a6.5 6.5 0 1 1 6 0"/><path d="M9.5 17h5M10 20.5h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
    warning: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
    danger: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>'
  };

  const icon = (name, size = 18) =>
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.file}</svg>`;

  // ---------- element helpers ----------

  function el(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  const esc = MD.escapeHtml;

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // ---------- formatting ----------

  const fmtDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const fmtDateTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  function fmtRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    if (days < 30) return `${Math.floor(days / 7)} 周前`;
    return fmtDate(ts);
  }

  const fmtBytes = (n) => {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  // ---------- toast ----------

  function toast(message, type = 'info') {
    const root = document.querySelector('#toastRoot');
    const node = el(`<div class="toast toast-${type}">${esc(message)}</div>`);
    root.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 300);
    }, 2600);
  }

  // ---------- dropdown menu ----------

  let openMenu = null;

  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }

  /* items: {label, icon, danger, checked, disabled, onClick, hint} | {sep:true} | {header:'...'} */
  function menu(anchor, items, { align = 'left', minWidth = 180 } = {}) {
    closeMenu();
    const node = el(`<div class="menu" style="min-width:${minWidth}px"></div>`);
    for (const item of items) {
      if (!item) continue;
      if (item.sep) { node.appendChild(el('<div class="menu-sep"></div>')); continue; }
      if (item.header) { node.appendChild(el(`<div class="menu-header">${esc(item.header)}</div>`)); continue; }
      const btn = el(`<button class="menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}">
        ${item.icon ? icon(item.icon, 16) : item.checked != null ? `<span class="menu-check">${item.checked ? icon('check', 14) : ''}</span>` : ''}
        <span class="menu-label">${esc(item.label)}</span>
        ${item.hint ? `<span class="menu-hint">${esc(item.hint)}</span>` : ''}
      </button>`);
      if (!item.disabled) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeMenu();
          item.onClick?.(e);
        });
      }
      node.appendChild(btn);
    }
    document.body.appendChild(node);
    const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, bottom: anchor.y, top: anchor.y };
    const mw = node.offsetWidth;
    const mh = node.offsetHeight;
    let x = align === 'right' ? rect.right - mw : rect.left;
    let y = rect.bottom + 4;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, rect.top - mh - 4);
    x = Math.min(Math.max(8, x), window.innerWidth - mw - 8);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    openMenu = node;
    setTimeout(() => {
      const dismiss = (e) => {
        if (!node.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', dismiss); }
      };
      document.addEventListener('mousedown', dismiss);
    }, 0);
    return node;
  }

  // ---------- modal ----------

  function modal({ title = '', body = '', footer = null, width = 520, onClose = null, cls = '' }) {
    const overlay = el(`<div class="modal-overlay"><div class="modal ${cls}" style="max-width:${width}px" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn modal-close" aria-label="关闭">${icon('x', 16)}</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot" hidden></div>
    </div></div>`);
    const bodyEl = overlay.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    const footEl = overlay.querySelector('.modal-foot');
    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 160);
      document.removeEventListener('keydown', onKey);
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    if (footer) {
      footEl.hidden = false;
      for (const b of footer) {
        const btn = el(`<button class="btn ${b.kind || ''}">${esc(b.label)}</button>`);
        btn.addEventListener('click', () => { if (b.onClick?.() !== false) { if (b.close !== false) close(); } });
        footEl.appendChild(btn);
      }
    }
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    document.querySelector('#modalRoot').appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    return { el: overlay, body: bodyEl, close };
  }

  function confirmDialog(title, message, { danger = false, okText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
      modal({
        title, width: 400,
        body: `<p class="confirm-text">${esc(message)}</p>`,
        footer: [
          { label: cancelText, onClick: () => resolve(false) },
          { label: okText, kind: danger ? 'btn-danger' : 'btn-primary', onClick: () => resolve(true) }
        ],
        onClose: () => resolve(false)
      });
    });
  }

  function promptDialog(title, { label = '', value = '', placeholder = '', okText = '确定' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const body = el(`<div class="form-col">
        ${label ? `<label class="form-label">${esc(label)}</label>` : ''}
        <input class="input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">
      </div>`);
      const input = body.querySelector('input');
      const m = modal({
        title, width: 400, body,
        footer: [
          { label: '取消' },
          { label: okText, kind: 'btn-primary', onClick: () => { done = true; resolve(input.value.trim()); } }
        ],
        onClose: () => { if (!done) resolve(null); }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { done = true; resolve(input.value.trim()); m.close(); }
      });
      setTimeout(() => { input.focus(); input.select(); }, 50);
    });
  }

  // ---------- files ----------

  function download(filename, data, mime = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function pickFiles(accept = '*/*', multiple = false) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }

  const readAsText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsText(file);
  });

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });

  // ---------- domain chips ----------

  const COLOR_NAMES = ['gray', 'stone', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];

  const statusPill = (statusId) => {
    const s = Store.statusById(statusId);
    return `<span class="status-pill c-${s.color || 'gray'}"><span class="status-dot"></span>${esc(s.name)}</span>`;
  };

  const tagChip = (name, { removable = false } = {}) => {
    const tag = Store.tagByName(name);
    return `<span class="tag-chip c-${tag?.color || 'gray'}" data-tag="${esc(name)}">${esc(name)}${removable ? `<button class="tag-remove" data-remove-tag="${esc(name)}" aria-label="移除标签">×</button>` : ''}</span>`;
  };

  function colorPicker(current, onPick) {
    const wrap = el('<div class="color-picker"></div>');
    for (const c of ['', ...COLOR_NAMES]) {
      const b = el(`<button class="color-swatch c-${c || 'none'}${current === c ? ' active' : ''}" title="${c || '默认'}"></button>`);
      b.addEventListener('click', () => onPick(c));
      wrap.appendChild(b);
    }
    return wrap;
  }

  /* Tag editor: chips + input with suggestions. onChange(tags[]) */
  function tagEditor(initial = [], onChange) {
    let tags = [...initial];
    const wrap = el(`<div class="tag-editor">
      <div class="tag-editor-chips"></div>
      <input class="tag-editor-input" type="text" placeholder="添加标签,回车确认">
      <div class="tag-suggest" hidden></div>
    </div>`);
    const chips = wrap.querySelector('.tag-editor-chips');
    const input = wrap.querySelector('.tag-editor-input');
    const suggest = wrap.querySelector('.tag-suggest');

    const renderChips = () => {
      chips.innerHTML = tags.map((t) => tagChip(t, { removable: true })).join('');
    };
    const commit = (name) => {
      name = name.trim().replace(/^#/, '');
      if (!name || tags.includes(name)) { input.value = ''; return; }
      tags.push(name);
      input.value = '';
      suggest.hidden = true;
      renderChips();
      onChange(tags);
    };
    const showSuggest = () => {
      const q = input.value.trim().toLowerCase();
      const options = Store.state.tags
        .map((t) => t.name)
        .filter((n) => !tags.includes(n) && (!q || n.toLowerCase().includes(q)))
        .slice(0, 8);
      suggest.innerHTML = options.map((n) => `<button class="tag-suggest-item" data-name="${esc(n)}">${esc(n)}<span>${Store.tagUsage(n)} 篇</span></button>`).join('');
      suggest.hidden = options.length === 0;
    };

    input.addEventListener('input', showSuggest);
    input.addEventListener('focus', showSuggest);
    input.addEventListener('blur', () => setTimeout(() => { suggest.hidden = true; }, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(input.value); }
      if (e.key === 'Backspace' && !input.value && tags.length) {
        tags.pop();
        renderChips();
        onChange(tags);
      }
    });
    suggest.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('[data-name]');
      if (btn) { e.preventDefault(); commit(btn.dataset.name); }
    });
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-tag]');
      if (btn) {
        tags = tags.filter((t) => t !== btn.dataset.removeTag);
        renderChips();
        onChange(tags);
      }
    });
    renderChips();
    return wrap;
  }

  // line-icon picker for category / template icons (stores the icon name)
  const ICON_CHOICES = [
    'pen', 'feather', 'notebook', 'bookOpen', 'file', 'calendar', 'flask', 'compass',
    'camera', 'mic', 'ruler', 'chart', 'coffee', 'mountain', 'globe', 'leaf',
    'music', 'heart', 'bulb', 'star', 'moon', 'sun', 'folder', 'tag',
    'layers', 'image', 'sparkle', 'target', 'clock', 'home'
  ];

  // render a stored entity icon name; unknown/legacy values fall back to a default
  const entityIcon = (name, size = 15, fallback = 'folder') =>
    icon(PATHS[name] ? name : fallback, size);

  function iconPick(anchor, onPick) {
    const node = el('<div class="menu icon-grid"></div>');
    node.appendChild(el('<button class="icon-cell" data-pick="" title="无图标">∅</button>'));
    for (const name of ICON_CHOICES) {
      node.appendChild(el(`<button class="icon-cell" data-pick="${name}">${icon(name, 16)}</button>`));
    }
    node.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-pick]');
      if (cell) { closeMenu(); onPick(cell.dataset.pick); }
    });
    closeMenu();
    document.body.appendChild(node);
    const rect = anchor.getBoundingClientRect();
    node.style.left = `${Math.min(rect.left, window.innerWidth - node.offsetWidth - 8)}px`;
    node.style.top = `${rect.bottom + 4}px`;
    openMenu = node;
    setTimeout(() => {
      const dismiss = (e) => {
        if (!node.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', dismiss); }
      };
      document.addEventListener('mousedown', dismiss);
    }, 0);
  }

  return {
    icon, el, esc, debounce,
    fmtDate, fmtDateTime, fmtRelative, fmtBytes,
    toast, menu, closeMenu, modal,
    confirm: confirmDialog, prompt: promptDialog,
    download, pickFiles, readAsText, blobToDataUrl,
    COLOR_NAMES, statusPill, tagChip, colorPicker, tagEditor, iconPick, entityIcon
  };
})();
