# WeWrite Studio

WeWrite Studio is a local desktop writing app for drafting, editing, and preparing WeChat Official Account articles with OpenAI API assistance.

Current app version: `0.1.18`.

## Features

- Local draft library with create, save, delete, saved-time labels, and preview.
- Paper-style editor with a right-side preview, assistant, and publish panel.
- AI writing assistant powered by the OpenAI API key saved on this device.
- WeChat draft upload through the Official Account API.
- Adjustable and collapsible library/right panel layout.
- Light/dark mode, settings, and navigation controls in the left rail.
- Linux `.deb` packaging and macOS `.dmg` packaging share the same app version.

## Development

```bash
npm install
npm start
```

Useful checks before packaging:

```bash
node --check main.js
node --check preload.js
node --check renderer/app.js
node --check services/openaiClient.js
node --check services/wechatClient.js
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

The macOS `.app` bundles are generated under `release/` for Apple Silicon and Intel:

```bash
npm run pack:mac
```

To create a distributable DMG:

```bash
npm run dist:mac
```

The DMG artifacts use the shared package version, for example:

```text
release/wechat-writing-studio-0.1.18-mac-arm64.dmg
release/wechat-writing-studio-0.1.18-mac-x64.dmg
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

## Release Builds

`package.json` is the single source of truth for the desktop app version. Keep Linux and macOS artifacts on the same version by bumping `package.json` and `package-lock.json` together, then tag the same version:

```bash
npm version 0.1.18 --no-git-tag-version
git commit -am "Prepare 0.1.18"
git tag v0.1.18
git push origin main --tags
```

GitHub Actions workflows:

- `Build Linux deb` builds and uploads the Debian/Ubuntu installer.
- `Build macOS DMG` builds and uploads Apple Silicon and Intel DMG installers.
- Pushing a tag like `v0.1.18` attaches matching Linux and macOS packages to the GitHub Release.

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

The app currently uses these WeChat APIs:

- Get `access_token`
- Upload permanent image asset
- Add draft

Recommended publishing flow: upload to the WeChat draft box, verify the draft in the official admin UI, then publish manually from WeChat after review.

Third-party platform scan-code authorization is planned separately. It requires a public HTTPS backend and a verified WeChat Open Platform third-party platform; the desktop app alone cannot replace that server-side authorization flow.
