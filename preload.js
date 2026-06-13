const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('writingDesk', {
  loadData: () => ipcRenderer.invoke('data:load'),
  createArticle: () => ipcRenderer.invoke('articles:create'),
  saveArticle: (article) => ipcRenderer.invoke('articles:save', article),
  deleteArticle: (articleId) => ipcRenderer.invoke('articles:delete', articleId),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseImage: () => ipcRenderer.invoke('dialog:chooseImage'),
  chooseFiles: () => ipcRenderer.invoke('dialog:chooseFiles'),
  readAttachments: (filePaths) => ipcRenderer.invoke('files:readAttachments', filePaths),
  runAssistant: (payload) => ipcRenderer.invoke('assistant:run', payload),
  createWechatDraft: (payload) => ipcRenderer.invoke('wechat:createDraft', payload)
});
