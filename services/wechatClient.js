const fs = require('node:fs/promises');
const path = require('node:path');

let tokenCache = {
  key: '',
  token: '',
  expiresAt: 0
};

const WECHAT_ERROR_HINTS = new Map([
  [40001, '请确认 AppSecret 是最新的，且与当前公众号 AppID 匹配。如果在后台重置过密钥，需要在设置中重新保存。'],
  [40013, '请检查公众号 AppID，应从「设置与开发 → 基本配置」中获取。'],
  [40014, 'access_token 无效。请重试操作，应用会重新获取新令牌。'],
  [40007, 'media_id 无效或已过期。请先重新上传草稿再发布。'],
  [40125, 'AppSecret 无效。请在公众号后台重新生成并保存。'],
  [40164, '当前服务器 IP 不在公众号 IP 白名单中。请在公众号后台「基本配置」里添加本机出口 IP。'],
  [45009, '微信 API 当日调用次数已达上限，请等配额重置后再试。'],
  [48001, '该公众号没有此接口权限。请确认账号类型（需已认证的服务号或订阅号）及已开通的开发者权限。'],
  [53503, '该草稿未通过发布检查，请在公众号后台检查草稿内容。'],
  [53504, '需要先在公众号后台完成风险操作验证。'],
  [53505, '请谨慎发布：内容可能存在风险，请人工确认后再试。'],
  [61003, '草稿箱接口对当前账号不可用。请确认公众号类型和 API 权限。']
]);

const PUBLISH_STATUS_TEXT = {
  0: '发布成功',
  1: '发布中',
  2: '原创声明失败',
  3: '常规失败',
  4: '平台审核不通过',
  5: '成功后用户删除所有文章',
  6: '成功后系统封禁所有文章'
};

function assertCredentials(settings) {
  if (!settings.wechatAppId || !settings.wechatAppSecret) {
    throw new Error('缺少公众号 AppID 或 AppSecret，请先在设置中填写。');
  }
}

function buildCredentialKey(settings) {
  return `${settings.wechatAppId}:${settings.wechatAppSecret.slice(0, 8)}`;
}

async function readWechatJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`微信 API 请求失败：HTTP ${response.status}`);
  }
  if (payload.errcode && payload.errcode !== 0) {
    const hint = WECHAT_ERROR_HINTS.get(payload.errcode);
    const message = `${payload.errmsg || '微信 API 返回错误'} (errcode: ${payload.errcode})`;
    throw new Error(hint ? `${message}\n\n建议：${hint}` : message);
  }
  return payload;
}

async function getAccessToken(settings, { forceRefresh = false } = {}) {
  assertCredentials(settings);

  const cacheKey = buildCredentialKey(settings);
  const now = Date.now();
  if (!forceRefresh && tokenCache.key === cacheKey && tokenCache.token && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', settings.wechatAppId);
  url.searchParams.set('secret', settings.wechatAppSecret);

  const payload = await readWechatJson(await fetch(url));
  if (!payload.access_token) {
    throw new Error('微信没有返回 access_token。');
  }

  tokenCache = {
    key: cacheKey,
    token: payload.access_token,
    expiresAt: now + Math.max(0, (payload.expires_in || 7200) - 300) * 1000
  };

  return payload.access_token;
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function buildImageForm(filePath) {
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append('media', new Blob([bytes], { type: mimeFromPath(filePath) }), path.basename(filePath));
  return form;
}

// 永久素材（封面用），返回 media_id。
async function uploadPermanentImage(accessToken, filePath) {
  if (!filePath) {
    throw new Error('请先上传封面图片，公众号草稿必须包含封面素材。');
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/material/add_material');
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('type', 'image');

  const payload = await readWechatJson(
    await fetch(url, { method: 'POST', body: await buildImageForm(filePath) })
  );

  if (!payload.media_id) {
    throw new Error('微信没有返回封面 media_id。');
  }
  return payload;
}

// 正文图片（uploadimg 接口，不占素材库额度），返回微信图床 URL。
async function uploadContentImage(accessToken, filePath) {
  const url = new URL('https://api.weixin.qq.com/cgi-bin/media/uploadimg');
  url.searchParams.set('access_token', accessToken);

  const payload = await readWechatJson(
    await fetch(url, { method: 'POST', body: await buildImageForm(filePath) })
  );

  if (!payload.url) {
    throw new Error('微信没有返回正文图片 URL。');
  }
  return payload.url;
}

// 把 HTML 中指向本地 /uploads/ 的图片换成微信图床地址（微信会过滤外部图片）。
async function replaceLocalImages(accessToken, html, resolveUpload) {
  const sources = [...new Set([...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]))];
  let result = html;

  for (const src of sources) {
    if (!src.startsWith('/uploads/')) continue;
    const filePath = resolveUpload(src);
    if (!filePath) {
      throw new Error(`正文图片不存在：${src}，请重新插入图片。`);
    }
    const wechatUrl = await uploadContentImage(accessToken, filePath);
    result = result.split(`src="${src}"`).join(`src="${wechatUrl}"`);
  }

  return result;
}

async function createDraft(settings, article, htmlContent, resolveUpload) {
  const accessToken = await getAccessToken(settings);

  const coverFile = resolveUpload ? resolveUpload(article.coverPath) : article.coverPath;
  if (!coverFile) {
    throw new Error('请先在发布面板上传封面图片。');
  }
  const cover = await uploadPermanentImage(accessToken, coverFile);

  const content = resolveUpload
    ? await replaceLocalImages(accessToken, htmlContent, resolveUpload)
    : htmlContent;

  const url = new URL('https://api.weixin.qq.com/cgi-bin/draft/add');
  url.searchParams.set('access_token', accessToken);

  const payload = await readWechatJson(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        articles: [
          {
            title: article.title || '未命名文章',
            author: article.author || '',
            digest: article.digest || '',
            content,
            content_source_url: article.sourceUrl || '',
            thumb_media_id: cover.media_id,
            show_cover_pic: article.showCover ? 1 : 0,
            need_open_comment: article.openComment ? 1 : 0,
            only_fans_can_comment: article.fansOnlyComment ? 1 : 0
          }
        ]
      })
    })
  );

  if (!payload.media_id) {
    throw new Error('微信没有返回草稿 media_id。');
  }

  return {
    mediaId: payload.media_id,
    coverMediaId: cover.media_id,
    coverUrl: cover.url || ''
  };
}

// 正式发布草稿（freepublish），发布是异步的，需要用 publish_id 轮询状态。
async function publishDraft(settings, mediaId) {
  if (!mediaId) {
    throw new Error('还没有草稿 media_id，请先上传到草稿箱。');
  }

  const accessToken = await getAccessToken(settings);
  const url = new URL('https://api.weixin.qq.com/cgi-bin/freepublish/submit');
  url.searchParams.set('access_token', accessToken);

  const payload = await readWechatJson(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ media_id: mediaId })
    })
  );

  if (!payload.publish_id) {
    throw new Error('微信没有返回 publish_id。');
  }

  return { publishId: String(payload.publish_id) };
}

async function getPublishStatus(settings, publishId) {
  if (!publishId) {
    throw new Error('还没有 publish_id，请先点击发布。');
  }

  const accessToken = await getAccessToken(settings);
  const url = new URL('https://api.weixin.qq.com/cgi-bin/freepublish/get');
  url.searchParams.set('access_token', accessToken);

  const payload = await readWechatJson(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ publish_id: publishId })
    })
  );

  const detail = payload.article_detail?.item?.[0] || {};
  return {
    publishStatus: payload.publish_status,
    statusText: PUBLISH_STATUS_TEXT[payload.publish_status] || `未知状态 ${payload.publish_status}`,
    articleId: payload.article_id || '',
    articleUrl: detail.article_url || '',
    failIdx: payload.fail_idx || []
  };
}

async function testConnection(settings) {
  const token = await getAccessToken(settings, { forceRefresh: true });
  return { ok: true, tokenPreview: `${token.slice(0, 12)}...` };
}

module.exports = {
  createDraft,
  publishDraft,
  getPublishStatus,
  getAccessToken,
  testConnection
};
