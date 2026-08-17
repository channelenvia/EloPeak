import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '..')
const sql = readFileSync(join(root, 'supabase', 'migrations_archive', '014_order_access_token_credentials.sql'), 'utf-8')
const fixSql = readFileSync(join(root, 'supabase', 'migrations_archive', '016_order_requires_access_token_service_type.sql'), 'utf-8')

function functionBlock(name: string, source = sql): string {
  const escaped = name.replace('.', '\\.')
  const match = source.match(new RegExp(`create (?:or replace )?function\\s+${escaped}[\\s\\S]*?\\n\\$\\$;`, 'i'))
  expect(match).not.toBeNull()
  return match![0]
}

describe('order access token hardening', () => {
  it('get_order_credentials retorna só token, nunca login/senha', () => {
    const block = functionBlock('public.get_order_credentials')
    expect(block).toContain("'access_token'")
    expect(block).not.toMatch(/'login'/i)
    expect(block).not.toMatch(/'password'/i)
    expect(block).not.toMatch(/pgp_sym_decrypt/i)
  })

  it('resolve_order_access_token é restrita a service_role', () => {
    expect(sql).toMatch(/revoke all on function public\.resolve_order_access_token\(text\) from public, anon, authenticated;/i)
    expect(sql).toMatch(/grant execute on function public\.resolve_order_access_token\(text\) to service_role;/i)
  })

  it('pedidos elegíveis só aparecem no pool quando credentials_set=true', () => {
    const viewStart = sql.indexOf('create or replace view public.available_boost_orders')
    const view = sql.slice(viewStart)
    expect(view).toMatch(/not public\.order_requires_access_token\(service_id, boost_mode\)\s+or credentials_set = true/i)
  })

  it('credenciais antigas são invalidadas para regenerar token no novo formato', () => {
    expect(sql).toMatch(/update public\.orders[\s\S]*set game_credentials = null,[\s\S]*credentials_set = false/i)
    expect(sql).toMatch(/public\.order_requires_access_token\(service_id, boost_mode\)/i)
  })

  it('serviços elegíveis excluem duo boost e coaching (definição original em 014, substituída por 016)', () => {
    const block = functionBlock('public.order_requires_access_token')
    expect(block).toMatch(/p_service_id = 'elo_boost' and coalesce\(p_boost_mode, 'solo'\) = 'solo'/i)
    expect(block).toMatch(/p_service_id in \('win_boost', 'placement_matches', 'md5'\)/i)
    expect(block).not.toContain("'coaching'")
  })

  // orders.service_id é o uuid de services.id (nunca o slug) — a predicate
  // original em 014 comparava p_service_id contra 'elo_boost'/'win_boost'/...
  // e nunca podia ser verdadeira. 016 substitui a função para receber
  // orders.service_type (enum, adicionada em 015) em vez de service_id.
  it('016 corrige order_requires_access_token para usar service_type, não service_id', () => {
    const block = functionBlock('public.order_requires_access_token', fixSql)
    expect(block).toMatch(/p_service_type public\.service_type/i)
    expect(block).toMatch(/p_service_type = 'elo_boost' and coalesce\(p_boost_mode, 'solo'\) = 'solo'/i)
    expect(block).toMatch(/p_service_type in \('win_boost', 'placement_matches', 'md5'\)/i)
    expect(block).not.toContain("'coaching'")
  })

  it('016 propaga service_type para todas as funções e para o pool de boosters', () => {
    expect(fixSql).toMatch(/drop function public\.order_requires_access_token\(text, text\);/i)
    expect(fixSql).toMatch(/public\.order_requires_access_token\(v_order\.service_type, v_order\.boost_mode\)/g)
    expect(fixSql).toMatch(/not public\.order_requires_access_token\(service_type, boost_mode\)\s+or credentials_set = true/i)
    expect(fixSql).toMatch(/public\.order_requires_access_token\(v_order\.service_type, v_order\.boost_mode\)\s+and not v_order\.credentials_set/i)
  })
})
