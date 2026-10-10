export {}

interface UpdateInfo {
  version: string
  url: string
  notes?: string
}

interface LauncherApi {
  getAuthStatus(): Promise<{ loggedIn: boolean; displayName: string | null; persistent: boolean }>
  checkUpdate(): Promise<UpdateInfo | null>
  openExternal(url: string): Promise<void>
  loginWithDiscord(): Promise<{ ok: true } | { ok: false; error: string }>
  logout(): Promise<void>
  submitToken(token: string): Promise<{ ok: true; leagueLaunched?: boolean } | { ok: false; error?: string }>
  onProgress(callback: (step: string) => void): () => void
}

declare global {
  interface Window {
    launcher: LauncherApi
  }
}

const loginScreen = document.getElementById('login-screen')!
const mainScreen = document.getElementById('main-screen')!
const discordLoginBtn = document.getElementById('discord-login-btn') as HTMLButtonElement
const discordLoginLabel = document.getElementById('discord-login-label')!
const loginError = document.getElementById('login-error')!
const userNameLabel = document.getElementById('user-name')!
const logoutBtn = document.getElementById('logout-btn')!
const tokenInput = document.getElementById('token-input') as HTMLTextAreaElement
const submitTokenBtn = document.getElementById('submit-token-btn') as HTMLButtonElement
const submitTokenSpinner = document.getElementById('submit-token-spinner')!
const submitTokenLabel = document.getElementById('submit-token-label')!
const progressBox = document.getElementById('progress')!
const progressText = document.getElementById('progress-text')!
const resultError = document.getElementById('result-error')!
const resultErrorText = document.getElementById('result-error-text')!
const updateBanner = document.getElementById('update-banner')!
const updateVersion = document.getElementById('update-version')!
const updateBtn = document.getElementById('update-btn') as HTMLButtonElement
const persistNotice = document.getElementById('persist-notice')!
let updateUrl: string | null = null

function showScreen(loggedIn: boolean, displayName?: string | null, persistent = true): void {
  loginScreen.classList.toggle('hidden', loggedIn)
  mainScreen.classList.toggle('hidden', !loggedIn)
  persistNotice.classList.toggle('hidden', persistent)
  if (loggedIn) userNameLabel.textContent = displayName ?? ''
}

function resetResult(): void {
  progressBox.classList.add('hidden')
  resultError.classList.add('hidden')
}

async function init(): Promise<void> {
  try {
    const status = await window.launcher.getAuthStatus()
    showScreen(status.loggedIn, status.displayName, status.persistent)
  } catch {
    // Sem estado de sessao: mostra a tela de login em vez de ficar em branco.
    showScreen(false)
  }

  // Aviso de versao nova (nunca baixa nem instala sozinho; sem manifesto configurado nao aparece nada).
  void window.launcher.checkUpdate().then((update) => {
    if (!update) return
    updateUrl = update.url
    updateVersion.textContent = update.version
    updateBanner.classList.remove('hidden')
  }).catch(() => { /* sem rede: ignora */ })

  window.launcher.onProgress((step) => {
    progressBox.classList.remove('hidden')
    progressText.textContent = step
  })
}

discordLoginBtn.addEventListener('click', async () => {
  loginError.classList.add('hidden')
  discordLoginBtn.setAttribute('disabled', 'true')
  discordLoginLabel.textContent = 'Abrindo o navegador…'
  try {
    const result = await window.launcher.loginWithDiscord()
    if (!result.ok) {
      loginError.textContent = result.error
      loginError.classList.remove('hidden')
      return
    }
    const status = await window.launcher.getAuthStatus()
    showScreen(status.loggedIn, status.displayName, status.persistent)
  } catch (err) {
    // Nunca deixa uma falha inesperada (ex.: erro do processo main não
    // convertido em { ok: false }) fechar em silêncio, sem nenhuma
    // mensagem — foi exatamente isso que mascarou o bug do WebSocket.
    loginError.textContent = err instanceof Error ? err.message : 'Erro inesperado ao entrar com Discord.'
    loginError.classList.remove('hidden')
  } finally {
    discordLoginBtn.removeAttribute('disabled')
    discordLoginLabel.textContent = 'Vincular Discord'
  }
})

logoutBtn.addEventListener('click', async () => {
  tokenInput.value = ''
  resetResult()
  await window.launcher.logout()
  showScreen(false)
})

submitTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim()
  if (!token) return
  resetResult()
  submitTokenBtn.setAttribute('disabled', 'true')
  submitTokenSpinner.classList.remove('hidden')
  submitTokenLabel.textContent = 'Autenticando…'
  progressBox.classList.remove('hidden')
  progressText.textContent = 'Resolvendo token…'
  try {
    const result = await window.launcher.submitToken(token)
    if (result.ok) {
      // Se o League não abriu sozinho, a última mensagem de progresso (via
      // onProgress) já traz a instrução de clicar em "Jogar" manualmente —
      // não sobrescreve nesse caso.
      if (result.leagueLaunched !== false) {
        progressText.textContent = 'Pronto! O League deve abrir em instantes.'
      }
      tokenInput.value = ''
      return
    }
    progressBox.classList.add('hidden')
    resultErrorText.textContent = result.error ?? 'Não foi possível entrar no jogo.'
    resultError.classList.remove('hidden')
  } catch (err) {
    progressBox.classList.add('hidden')
    resultErrorText.textContent = err instanceof Error ? err.message : 'Erro inesperado ao autenticar.'
    resultError.classList.remove('hidden')
  } finally {
    // O token nunca fica no campo depois de uma tentativa (sucesso ou erro).
    tokenInput.value = ''
    submitTokenBtn.removeAttribute('disabled')
    submitTokenSpinner.classList.add('hidden')
    submitTokenLabel.textContent = 'Autenticar'
  }
})

updateBtn.addEventListener('click', () => {
  if (updateUrl) void window.launcher.openExternal(updateUrl)
})

// Ctrl+Enter no campo do token = clicar em Autenticar.
tokenInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submitTokenBtn.click()
})

void init()
