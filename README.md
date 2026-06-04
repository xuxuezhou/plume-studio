# 公众号写作台

一个本地 Mac 写作应用第一版：支持文章管理、Markdown 写作、AI 辅助改稿、微信公众号凭据配置、推送到公众号草稿箱，以及人工确认后提交发布。

## 第一版功能

- 本地文章库：新建、保存、删除、预览。
- AI 写作助手：提纲、标题、改写、摘要、审稿、微信排版建议。
- 微信公众号连接：保存 AppID/AppSecret，测试连接。
- 草稿箱发布：上传封面图，创建微信公众号草稿。
- 发布提交：使用草稿 `media_id` 提交发布，并记录状态。

## 本地运行

```bash
npm install
npm start
```

## 打包 Mac App

```bash
npm run pack
```

打包后的 `.app` 会生成在 `release/mac/公众号写作台.app`。

## 配置

在应用右侧「设置」里填写：

- OpenAI API Key
- OpenAI model，默认 `gpt-5.4-mini`
- 微信公众号 AppID
- 微信公众号 AppSecret

也可以在启动前设置环境变量：

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-5.4-mini"
npm start
```

## 微信公众号准备

公众号后台需要启用开发配置，并把当前机器或发布服务器的出口 IP 加入 IP 白名单。第一版使用的微信接口包括：

- 获取 `access_token`
- 上传永久图片素材
- 新增草稿
- 提交发布
- 查询发布状态

建议先只使用「推送草稿」，确认草稿在公众号后台显示正常后，再使用「提交发布」。
