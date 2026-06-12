# WeWrite Studio

A local desktop writing app for drafting, editing, and preparing WeChat Official Account articles with AI assistance. WeWrite Studio supports macOS and Linux.

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

## Build Desktop Packages

Build an unpacked app for the current platform:

```bash
npm run pack
```

Build a distributable package for the current platform:

```bash
npm run dist
```

### macOS

The macOS `.app` bundle is generated in `release/mac-arm64/WeWrite Studio.app`:

```bash
npm run pack:mac
```

To create a distributable DMG:

```bash
npm run dist:mac
```

### Linux

The Linux unpacked app is generated in `release/linux-unpacked`:

```bash
npm run pack:linux
```

To create a Linux `.deb` installer for Debian/Ubuntu-based systems:

```bash
npm run dist:linux
```

The package is written to `release/wechat-writing-studio-<version>-linux-amd64.deb`.

Install the generated package:

```bash
sudo apt install ./release/wechat-writing-studio-*-linux-*.deb
```

The installed app appears in the desktop launcher as `WeWrite Studio`.

## Publish a Linux Release

The `Build Linux deb` GitHub Actions workflow builds the `.deb` installer on Ubuntu.

- Run it manually from the Actions tab to download the `.deb` artifact.
- Push a version tag such as `v0.1.16` to attach the `.deb` to a GitHub Release automatically.

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
