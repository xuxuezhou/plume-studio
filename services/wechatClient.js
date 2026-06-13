const fs = require('node:fs/promises');
const path = require('node:path');

let tokenCache = {
  key: '',
  token: '',
  expiresAt: 0
};

const WECHAT_ERROR_HINTS = new Map([
  [40001, 'Check that the AppSecret is current and belongs to the same Official Account AppID. If it was reset in the admin console, save the new secret here.'],
  [40013, 'Check the Official Account AppID. It should come from Settings and Development > Basic Configuration.'],
  [40014, 'The access token is invalid. Retry the action; the app will request a fresh token.'],
  [40007, 'The media_id is invalid or expired. Recreate the WeChat draft before publishing.'],
  [40125, 'The AppSecret is invalid. Regenerate it in the WeChat Official Account admin console and save it again.'],
  [40164, 'This machine or server IP is not in the WeChat API allowlist. Add the current egress IP in the Official Account admin console.'],
  [45009, 'The WeChat API daily quota has been reached. Try again after the quota resets.'],
  [48001, 'This Official Account does not have permission for the requested API. Confirm the account type and enabled developer permissions.'],
  [61003, 'Draft box APIs are unavailable for this account or permission set. Confirm the Official Account type and API permissions.']
]);

function assertCredentials(settings) {
  if (!settings.wechatAppId || !settings.wechatAppSecret) {
    throw new Error('Missing WeChat Official Account AppID or AppSecret. Add them in Settings first.');
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
  return 'image/jpeg';
}

async function appendFileToForm(form, filePath) {
  const bytes = await fs.readFile(filePath);
  const blob = new Blob([bytes], { type: mimeFromPath(filePath) });
  form.append('media', blob, path.basename(filePath));
}

async function uploadPermanentImage(accessToken, filePath) {
  if (!filePath) {
    throw new Error('Choose a cover image first. WeChat drafts require a cover asset.');
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/material/add_material');
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('type', 'image');

  const form = new FormData();
  await appendFileToForm(form, filePath);

  const payload = await readWechatJson(
    await fetch(url, {
      method: 'POST',
      body: form
    })
  );

  if (!payload.media_id) {
    throw new Error('WeChat did not return a cover media_id.');
  }

  return payload;
}

async function createDraft(settings, article, htmlContent) {
  const accessToken = await getAccessToken(settings);
  const cover = await uploadPermanentImage(accessToken, article.coverPath);

  const url = new URL('https://api.weixin.qq.com/cgi-bin/draft/add');
  url.searchParams.set('access_token', accessToken);

  const payload = await readWechatJson(
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        articles: [
          {
            title: article.title || 'Untitled Article',
            author: article.author || '',
            digest: article.digest || '',
            content: htmlContent,
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
    coverUrl: cover.url || '',
    raw: payload
  };
}

module.exports = {
  createDraft,
  getAccessToken
};
