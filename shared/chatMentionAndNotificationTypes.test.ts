import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Verificação estática (sem Supabase local disponível neste ambiente, ver
// outros testes em shared/): garante que dois bugs concretos de chat/notificação
// não voltem.
const root = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(root, relPath), 'utf-8')
}

describe('discord-chat-mention aceita admin mencionado (não só cliente/booster do pedido)', () => {
  it('checa profile.role antes de rejeitar como "não participante"', () => {
    const content = read('supabase/functions/discord-chat-mention/index.ts')
    // send_order_message (migration 20260906200000_chat_mention_wiring.sql)
    // aceita qualquer admin como alvo válido de @menção -- sem essa exceção
    // aqui, o DM nunca saía pra um admin mencionado (a notificação in-app
    // gravava normalmente, só o Discord ficava mudo).
    expect(content).toMatch(/select\('discord_id,\s*role'\)/)
    expect(content).toMatch(/profile\.role\s*!==\s*'admin'/)
  })
})

describe('NotificationType/TYPE_ICON cobrem os tipos gravados pelas RPCs de drop', () => {
  it('drop_fee_applied e drop_request_pending_admin existem no union do frontend', () => {
    const content = read('src/types/index.ts')
    expect(content).toContain("'drop_fee_applied'")
    expect(content).toContain("'drop_request_pending_admin'")
  })

  it('NotificationBell mapeia ícone pros dois tipos (sem cair no Bell genérico)', () => {
    const content = read('src/components/NotificationBell.tsx')
    expect(content).toMatch(/drop_fee_applied:\s*\w+,/)
    expect(content).toMatch(/drop_request_pending_admin:\s*\w+,/)
  })
})
