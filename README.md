# WeWrite Studio

A local Mac writing app for drafting, editing, and preparing WeChat Official Account articles with AI assistance.

## Current Features

- Local article library: create, save, delete, preview.
- AI writing assistant: outline, titles, rewrite, digest, review, and WeChat-friendly formatting.
- Adjustable workspace: draggable library, editor/preview, and side panel widths.
- Collapsible sidebars: hide the library or right-side panel when you want a focused drafting surface.
- Light/dark mode with local layout persistence.
- WeChat connection settings: AppID/AppSecret storage, connection test, draft-box publishing, publish submission, and status lookup.

## Run Locally

```bash
npm install
npm start
```

## Build the Mac App

```bash
npm run pack
```

The `.app` bundle is generated in `release/mac-arm64/WeWrite Studio.app`.

To create a distributable DMG:

```bash
npm run dist
```

## Configuration

In the app, open Settings and fill in:

- OpenAI API Key
- OpenAI model, default `gpt-5.4-mini`
- WeChat Official Account AppID
- WeChat Official Account AppSecret

You can also provide OpenAI credentials before launch:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-5.4-mini"
npm start
```

## WeChat Setup

In the WeChat Official Account admin console, enable developer configuration and add the current machine or publishing server egress IP to the API allowlist.

The first version uses these WeChat APIs:

- Get `access_token`
- Upload permanent image asset
- Add draft
- Submit publish
- Query publish status

Recommended publishing flow: send to the WeChat draft box first, verify the draft in the official admin UI, then manually submit publish from this app only after review.
