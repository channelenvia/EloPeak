import { contextBridge, ipcRenderer } from 'electron'

// Superfície exposta ao renderer — nunca inclui login/senha em texto puro.
// O processo main resolve credenciais e fala com o Riot Client sozinho; o
// renderer só recebe status/progresso.
contextBridge.exposeInMainWorld('launcher', {
  getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),
  loginWithDiscord: () => ipcRenderer.invoke('auth:loginWithDiscord'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  submitToken: (token: string) => ipcRenderer.invoke('token:submit', token),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  onProgress: (callback: (step: string) => void) => {
    const listener = (_event: unknown, step: string) => callback(step)
    ipcRenderer.on('token:progress', listener)
    return () => ipcRenderer.removeListener('token:progress', listener)
  },
})
