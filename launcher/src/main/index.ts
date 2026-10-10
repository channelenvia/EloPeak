import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config, isSessionPersistenceAvailable } from './config'
import { loginWithDiscord, logout, getSessionDisplayName, resolveCredentials } from './credentials'
import { autoLoginToRiotClient, GameRunningError, inspectRiotClient, killActiveLogin, prelaunchRiotClient, prewarmNativeHelper } from './riotClient'
import { checkForUpdate } from './updateCheck'

let mainWindow: BrowserWindow | null = null
// Trava de reentrancia: dois cliques em "Autenticar" abriam dois PowerShell, dois BlockInput e dois taskkill.
let tokenSubmitInFlight = false

const RENDERER_INDEX = join(__dirname, '..', 'renderer', 'index.html')
const RENDERER_URL = pathToFileURL(RENDERER_INDEX).href
const MAX_TOKEN_LENGTH = 8192

// So a janela do proprio app (o index.html empacotado) pode falar com o processo main: qualquer outro frame/origem
// que consiga um IPC e ignorado.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  const url = frame?.url ?? ''
  // Alem da URL, tem que ser o frame principal da nossa janela (nao um subframe).
  const isMainFrame = !!mainWindow && frame?.frameTreeNodeId === mainWindow.webContents.mainFrame.frameTreeNodeId
  return isMainFrame && url.split('#', 1)[0] === RENDERER_URL
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 700,
    resizable: false,
    autoHideMenuBar: true,
    title: 'Booster Launcher',
    backgroundColor: '#0E0E10',
    // Sem isso, em dev (npx electron .) a janela usa o logo genérico do
    // Electron — o .exe empacotado já embute build/icon.ico via
    // electron-builder, mas isso não é copiado pros resources do app, então
    // usamos o mesmo PNG que fica em dist/renderer (presente nos dois casos).
    icon: join(__dirname, '..', 'renderer', 'app-icon.png'),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // DevTools so em desenvolvimento: no app instalado o booster (ou um script injetado) nao inspeciona o processo.
      devTools: !app.isPackaged,
    },
  })
  mainWindow.setMenuBarVisibility(false)

  const contents = mainWindow.webContents
  // A UI nunca abre janelas novas nem navega para fora do index.html (links externos so por shell.openExternal https).
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttpsUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const blockForeignNavigation = (details: { url: string; preventDefault(): void }) => {
    if (details.url.split('#', 1)[0] !== RENDERER_URL) details.preventDefault()
  }
  contents.on('will-navigate', blockForeignNavigation)
  contents.on('will-frame-navigate', blockForeignNavigation)
  contents.on('will-redirect', blockForeignNavigation)
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  contents.session.setPermissionCheckHandler(() => false)

  mainWindow.loadFile(RENDERER_INDEX)
  mainWindow.on('closed', () => { mainWindow = null })
}

// Uma instancia so: duas aberturas disputariam o Riot Client, o prelaunch e o BlockInput.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    createWindow()
    // Deixa o Riot Client já aberto (tela de login) desde a abertura do
    // Booster Launcher, em paralelo ao booster logando com Discord/colando o
    // token — quando ele clicar em "Autenticar", o client já está quente.
    void prelaunchRiotClient()
    // Compila o helper nativo de clique/digitação uma única vez (cacheado em
    // disco) em vez de recompilar toda hora que o booster loga — é o maior
    // custo fixo do fluxo de login (ver comentário em prewarmNativeHelper).
    prewarmNativeHelper()

    ipcMain.handle('auth:getStatus', async (event) => {
      if (!isTrustedSender(event)) return { loggedIn: false, displayName: null, persistent: true }
      const displayName = await getSessionDisplayName()
      return { loggedIn: !!displayName, displayName, persistent: isSessionPersistenceAvailable() }
    })

    ipcMain.handle('auth:loginWithDiscord', async (event) => {
      if (!isTrustedSender(event)) return { ok: false as const, error: 'Origem não autorizada.' }
      return loginWithDiscord()
    })

    ipcMain.handle('auth:logout', async (event) => {
      if (!isTrustedSender(event)) return
      await logout()
    })

    ipcMain.handle('app:checkUpdate', async (event) => {
      if (!isTrustedSender(event)) return null
      return checkForUpdate(app.getVersion(), config.updateManifestUrl)
    })

    ipcMain.handle('app:openExternal', async (event, url: unknown) => {
      if (!isTrustedSender(event) || !isHttpsUrl(url)) return
      await shell.openExternal(url)
    })

    ipcMain.handle('token:submit', async (event, token: unknown) => {
      if (!isTrustedSender(event)) return { ok: false as const, error: 'Origem não autorizada.' }
      // Valida o que vem do renderer: tipo e tamanho (o token cifrado é curto).
      if (typeof token !== 'string' || token.trim().length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return { ok: false as const, error: 'Token inválido.' }
      }
      if (tokenSubmitInFlight) {
        return { ok: false as const, error: 'Já existe uma autenticação em andamento. Aguarde terminar.' }
      }
      tokenSubmitInFlight = true
      try {
        // Antes de gastar o token (uso unico no servidor): se o Riot Client precisaria reiniciar com o jogo aberto,
        // para aqui e o booster nao precisa gerar outro token.
        const riotState = await inspectRiotClient()
        if (riotState.blockedByGame) return { ok: false as const, error: new GameRunningError().message }
        const resolved = await resolveCredentials(token.trim())
        const result = await autoLoginToRiotClient(
          resolved.login,
          resolved.password,
          (step) => { if (!event.sender.isDestroyed()) event.sender.send('token:progress', step) },
          null,
          riotState,
        )
        if (result.ok) return { ok: true as const, leagueLaunched: result.leagueLaunched }
        return { ok: false as const, error: result.error }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : 'Erro desconhecido.' }
      } finally {
        tokenSubmitInFlight = false
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => killActiveLogin())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
