const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('writingDesk', {
  loadData: () => ipcRenderer.invoke('data:load'),
  createArticle: () => ipcRenderer.invoke('articles:create'),
  saveArticle: (article) => ipcRenderer.invoke('articles:save', article),
  deleteArticle: (articleId) => ipcRenderer.invoke('articles:delete', articleId),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseImage: () => ipcRenderer.invoke('dialog:chooseImage'),
  runAssistant: (payload) => ipcRenderer.invoke('assistant:run', payload),
  openChatGptLogin: () => ipcRenderer.invoke('account:openChatGpt'),
  testWechat: () => ipcRenderer.invoke('wechat:test'),
  createWechatDraft: (payload) => ipcRenderer.invoke('wechat:createDraft', payload),
  publishWechatDraft: (payload) => ipcRenderer.invoke('wechat:publish', payload),
  getWechatStatus: (payload) => ipcRenderer.invoke('wechat:status', payload)
});
