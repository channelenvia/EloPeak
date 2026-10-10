import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { WebSocketLikeConstructor } from '@supabase/realtime-js'
import WebSocket from 'ws'

interface LauncherConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Opcional: manifesto JSON (https) com a versao mais nova, ver updateCheck.ts. */
  updateManifestUrl?: string
}

function loadConfig(): LauncherConfig {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'config.json')
    : join(__dirname, '..', '..', 'config.json')

  if (!existsSync(path)) {
    throw new Error(
      `Config não encontrado em ${path}. Crie o config.json (supabaseUrl e supabaseAnonKey; formato no launcher/README.md).`,
    )
  }

  let raw: Partial<LauncherConfig>
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LauncherConfig>
  } catch {
    throw new Error(`config.json em ${path} não é um JSON válido.`)
  }
  if (!raw.supabaseUrl || !raw.supabaseAnonKey) {
    throw new Error('config.json incompleto: supabaseUrl e supabaseAnonKey são obrigatórios.')
  }
  return { supabaseUrl: raw.supabaseUrl, supabaseAnonKey: raw.supabaseAnonKey, updateManifestUrl: raw.updateManifestUrl }
}

export const config = loadConfig()

// Sessão do Supabase (refresh token) persistida localmente cifrada via
// safeStorage (DPAPI no Windows, atrelada ao login do Windows do booster) —
// nunca em texto puro no disco. Se a criptografia não estiver disponível na
// máquina, a sessão simplesmente não persiste entre aberturas do app (o
// booster loga de novo), nunca cai para um armazenamento inseguro.
function sessionFilePath(): string {
  return join(app.getPath('userData'), 'session.enc')
}

// Sem criptografia do sistema a sessao NAO vai para o disco, mas o login precisa funcionar: o verifier do PKCE e a
// sessao ficam so em memoria durante a execucao.
let memoryStore: Record<string, string> = {}

function readStore(): Record<string, string> {
  if (!safeStorage.isEncryptionAvailable()) return memoryStore
  const path = sessionFilePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(path))) as Record<string, string>
  } catch {
    return {}
  }
}

// false quando o sistema nao tem criptografia (safeStorage): o login funciona, mas a sessao nao fica salva
// entre aberturas do app (a UI avisa o booster).
export function isSessionPersistenceAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

const RENAME_RETRIES = 4
const RENAME_RETRY_DELAY_MS = 40

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      // No Windows um antivirus segurando o arquivo da EPERM/EBUSY por instantes.
      if (attempt >= RENAME_RETRIES) throw err
      const until = Date.now() + RENAME_RETRY_DELAY_MS
      while (Date.now() < until) { /* espera curta e sincrona (rotina pequena, chamada rara) */ }
    }
  }
}

function writeStore(store: Record<string, string>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    memoryStore = store
    return
  }
  mkdirSync(app.getPath('userData'), { recursive: true })
  // Escrita atomica (arquivo temporario + rename): um crash no meio nao apaga a sessao nem o verifier do PKCE.
  const target = sessionFilePath()
  const tmp = `${target}.tmp`
  writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(store)))
  renameWithRetry(tmp, target)
}

export function clearStoredSession(): void {
  try { writeStore({}) } catch { /* melhor esforco */ }
}

const secureStorage = {
  getItem(key: string): string | null {
    return readStore()[key] ?? null
  },
  setItem(key: string, value: string): void {
    const store = readStore()
    store[key] = value
    writeStore(store)
  },
  removeItem(key: string): void {
    const store = readStore()
    delete store[key]
    writeStore(store)
  },
}

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: secureStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        // PKCE em vez do fluxo implícito: o code_verifier fica guardado no
        // storage acima e o retorno do Discord chega como ?code=... (não
        // #access_token=...) — só assim um servidor HTTP local (sem acesso
        // ao fragmento da URL) consegue capturar o callback do OAuth.
        flowType: 'pkce',
      },
      // O processo main do Electron roda em Node embutido sem WebSocket
      // global (só chega no Node 22+) — o SupabaseClient sempre monta um
      // RealtimeClient internamente (mesmo sem usar .channel() nenhuma vez)
      // e quebra na hora de criar o client sem isso. Nunca usamos Realtime
      // aqui; é só pra satisfazer essa inicialização.
      realtime: {
        transport: WebSocket as unknown as WebSocketLikeConstructor,
      },
    })
  }
  return client
}
