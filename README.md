<p align="center">
  <img src="public/brand/cover.svg" alt="Plume Studio — Write, refine, and publish, beautifully." width="100%" />
</p>

# Plume Studio

**Plume Studio** is a web-based writing desk for WeChat Official Account articles: write in your browser, refine with an AI co-writer, then upload to the WeChat draft box and publish in one click.

- **Public site**: <https://plume-studio.vercel.app> — runs entirely in your browser (drafts live in localStorage, bring your own AI key); WeChat publishing is disabled there
- **Self-hosted**: <http://localhost:5757> — full features including WeChat publishing (see below)

Current version: `0.4.0`.

## Features

- **Draft library** — create / save / delete / search, autosave with a status indicator, saved-time labels
- **Paper-style editor** — Markdown writing with live preview, character count, and image insertion via button, drag-and-drop, or paste
- **AI co-writer** — streaming chat whose history is saved per article; quick actions for outline, titles, rewrite, digest, and review; replies can be inserted straight into the draft; reference files can be attached
- **WeChat publishing** (self-hosted only):
  - Cover upload as permanent material
  - Local images in the body are auto-uploaded to the WeChat CDN and their URLs rewritten
  - Publish-ready HTML is generated with inline styles (the WeChat editor strips classes and external CSS)
  - Upload to draft box → publish (freepublish) → check publish status / article link
- **Interface** — light / dark theme (follows the system), resizable and collapsible side panels

## Two modes, one codebase

| | Public site (Vercel) | Self-hosted |
|---|---|---|
| Storage | Browser localStorage | `~/.wewrite-studio/` on disk |
| AI assistant | Browser → OpenAI-compatible API with your key | Proxied through the local server |
| WeChat publishing | Not available (WeChat requires a fixed, allowlisted server IP) | Fully supported |
| Your keys | Never leave your browser | Never leave your machine |

The frontend detects the mode automatically: if `/api/data` responds, it uses the server; otherwise it switches to browser mode.

## Quick start (self-hosted)

```bash
npm install
npm start
```

Then open <http://localhost:5757>.

### Permanent URL (macOS service)

```bash
npm run service:install
```

After this, **http://localhost:5757** is always available: the server starts at login and restarts automatically if it crashes. Remove with `npm run service:uninstall`.

Development mode (auto-restart on changes): `npm run dev`. Syntax checks: `npm run check`.

## Configuration

Open **Settings** in the app (bottom-left gear), or use environment variables / `.env` (see `.env.example`):

### AI assistant (OpenAI-compatible)

- **API key** — create one at <https://platform.openai.com>. Note: a ChatGPT Plus subscription cannot be used by third-party apps; the API key is billed by usage.
- **Base URL** (optional) — any OpenAI-compatible endpoint, e.g. a self-hosted proxy or another provider.
- **Model** — defaults to `gpt-5.4-mini`; switch it in Settings or in the chat composer.

### WeChat Official Account (self-hosted only)

1. Get the **AppID** and **AppSecret** from Settings & Development → Basic Configuration in the WeChat admin console
2. Add this machine's **egress IP** to the IP allowlist
3. Draft and publish APIs require a **verified** account

Recommended flow: upload to the draft box → review in the WeChat admin console → then publish. Publishing pushes the article to readers immediately.

## Data storage (self-hosted)

Everything lives in `~/.wewrite-studio/`:

- `data.json` — articles, chat history, settings (contains plaintext keys, file mode 600; do not commit or share)
- `uploads/` — inserted images and covers
- `plume-studio.log` — service log

Set `WEWRITE_DATA_DIR` to change the location. The server binds to `127.0.0.1` by default; set `HOST=0.0.0.0` for LAN access, but note there is no login — do not expose it to the public internet.

## Deployment

The public site is a static deployment of `public/` (see `vercel.json`):

```bash
vercel deploy --prod
```

## Project structure

```
server.js                  Express server and API routes (self-hosted mode)
lib/store.js               JSON data store (articles / settings / uploads)
public/                    Frontend (also deployed standalone to Vercel)
  backend.js               Backend abstraction: server API vs. in-browser store
  shared/markdown.js       Shared Markdown renderer (preview + WeChat inline-styled HTML)
  brand/cover.svg          Cover art
services/openaiClient.js   OpenAI-compatible API client (streaming)
services/wechatClient.js   WeChat Official Account API (material / draft / publish / status)
scripts/                   macOS LaunchAgent install / uninstall
```
