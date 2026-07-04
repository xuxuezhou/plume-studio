const fs = require('node:fs/promises');
const path = require('node:path');

let tokenCache = {
  key: '',
  token: '',
  expiresAt: 0
};

const WECHAT_ERROR_HINTS = new Map([
  [40001, 'Check that the AppSecret is current and matches this AppID. If it was reset in the WeChat admin console, save the new secret in Settings.'],
  [40013, 'Check the Official Account AppID. It comes from Settings and Development > Basic Configuration in the WeChat admin console.'],
  [40014, 'The access token is invalid. Retry the action; the app will request a fresh token.'],
  [40007, 'The media_id is invalid or expired. Upload the draft again before publishing.'],
  [40125, 'The AppSecret is invalid. Regenerate it in the WeChat admin console and save it again.'],
  [40164, 'This server IP is not in the WeChat IP allowlist. Add the current egress IP in the WeChat admin console under Basic Configuration.'],
  [45009, 'The WeChat API daily quota has been reached. Try again after the quota resets.'],
  [48001, 'This Official Account lacks permission for this API. It must be a verified account with developer permissions enabled.'],
  [53503, 'The draft failed the publish check. Review the draft content in the WeChat admin console.'],
  [53504, 'Complete the risk-operation verification in the WeChat admin console first.'],
  [53505, 'Publish with caution: the content may be flagged as risky. Confirm manually and try again.'],
  [61003, 'Draft box APIs are unavailable for this account. Confirm the account type and API permissions.']
]);

const PUBLISH_STATUS_TEXT = {
  0: 'Published successfully',
  1: 'Publishing',
  2: 'Original-statement check failed',
  3: 'Failed',
  4: 'Rejected by platform review',
  5: 'Published, then all articles deleted by user',
  6: 'Published, then all articles blocked by platform'
};

function assertCredentials(settings) {
  if (!settings.wechatAppId || !settings.wechatAppSecret) {
    throw new Error('Missing WeChat AppID or AppSecret. Add them in Settings first.');
  }
}

function buildCredentialKey(settings) {
  return `${settings.wechatAppId}:${settings.wechatAppSecret.slice(0, 8)}`;
}

async function readWechatJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`WeChat API request failed: HTTP ${response.status}`);
  }
  if (payload.errcode && payload.errcode !== 0) {
    const hint = WECHAT_ERROR_HINTS.get(payload.errcode);
    const message = `${payload.errmsg || 'WeChat API returned an error'} (errcode: ${payload.errcode})`;
    throw new Error(hint ? `${message}\n\nSuggested fix: ${hint}` : message);
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
    throw new Error('WeChat did not return an access_token.');
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

// Permanent material (used for covers); returns a media_id.
async function uploadPermanentImage(accessToken, filePath) {
  if (!filePath) {
    throw new Error('Upload a cover image first. WeChat drafts require a cover asset.');
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/material/add_material');
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('type', 'image');

  const payload = await readWechatJson(
    await fetch(url, { method: 'POST', body: await buildImageForm(filePath) })
  );

  if (!payload.media_id) {
    throw new Error('WeChat did not return a cover media_id.');
  }
  return payload;
}

// Content image via uploadimg (does not count against the material quota); returns a WeChat CDN URL.
async function uploadContentImage(accessToken, filePath) {
  const url = new URL('https://api.weixin.qq.com/cgi-bin/media/uploadimg');
  url.searchParams.set('access_token', accessToken);

  const payload = await readWechatJson(
    await fetch(url, { method: 'POST', body: await buildImageForm(filePath) })
  );

  if (!payload.url) {
    throw new Error('WeChat did not return a content image URL.');
  }
  return payload.url;
}

// Replace local /uploads/ images with WeChat CDN URLs (WeChat strips external images).
async function replaceLocalImages(accessToken, html, resolveUpload) {
  const sources = [...new Set([...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]))];
  let result = html;

  for (const src of sources) {
    if (!src.startsWith('/uploads/')) continue;
    const filePath = resolveUpload(src);
    if (!filePath) {
      throw new Error(`Content image not found: ${src}. Re-insert the image.`);
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
    throw new Error('Upload a cover image in the Publish panel first.');
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
            title: article.title || 'Untitled',
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
    throw new Error('WeChat did not return a draft media_id.');
  }

  return {
    mediaId: payload.media_id,
    coverMediaId: cover.media_id,
    coverUrl: cover.url || ''
  };
}

// Publish a draft via freepublish. Publishing is async; poll status with the publish_id.
async function publishDraft(settings, mediaId) {
  if (!mediaId) {
    throw new Error('No draft media_id yet. Upload to the draft box first.');
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
    throw new Error('WeChat did not return a publish_id.');
  }

  return { publishId: String(payload.publish_id) };
}

async function getPublishStatus(settings, publishId) {
  if (!publishId) {
    throw new Error('No publish_id yet. Click Publish first.');
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
    statusText: PUBLISH_STATUS_TEXT[payload.publish_status] || `Unknown status ${payload.publish_status}`,
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
