// Testes de guarda sobre o texto da migration -- mesmo padrão de
// shared/securityHardening.test.ts: não roda SQL de verdade (isso exige um
// banco Postgres), só garante que a migration contém as peças estruturais
// que este plano promete, e que a assinatura antiga de record_order_match é
// derrubada antes da nova ser criada (Postgres trata parâmetros diferentes
// como uma sobrecarga nova, não uma substituição).
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationPromise = readFile(
  new URL('../supabase/migrations/140_booster_performance_extended_stats.sql', import.meta.url),
  'utf8',
)

describe('migration 140 — extended performance stats', () => {
  it('adiciona minions_killed/neutral_minions_killed/is_mvp em order_matches', async () => {
    const sql = await migrationPromise
    expect(sql).toMatch(/alter table public\.order_matches[\s\S]*?add column minions_killed integer/)
    expect(sql).toMatch(/add column neutral_minions_killed integer/)
    expect(sql).toMatch(/add column is_mvp boolean not null default false/)
  })

  it('derruba a assinatura antiga de record_order_match antes de recriar', async () => {
    // Normaliza CRLF -> LF antes do indexOf -- este arquivo tem quebras de
    // linha CRLF neste checkout (Windows), e a assinatura procurada abaixo
    // abrange uma quebra de linha real no SQL.
    const sql = (await migrationPromise).replace(/\r\n/g, '\n')
    const dropIdx = sql.indexOf('drop function if exists public.record_order_match(uuid, text, text, text, integer, integer, integer, integer, integer, timestamptz)')
    const createIdx = sql.indexOf('create or replace function public.record_order_match(\n  p_order_id uuid,')
    expect(dropIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(-1)
    expect(dropIdx).toBeLessThan(createIdx)
  })

  it('estende booster_performance_segments com account_type, queue_type, avg_cs_per_min, mvp_count', async () => {
    const sql = await migrationPromise
    expect(sql).toMatch(/add column account_type text not null default '__all__'/)
    expect(sql).toMatch(/add column queue_type text not null default '__all__'/)
    expect(sql).toMatch(/add column avg_cs_per_min numeric/)
    expect(sql).toMatch(/add column mvp_count integer not null default 0/)
  })

  it('cria booster_champion_stats com unique (booster_id, account_type, champion)', async () => {
    const sql = await migrationPromise
    expect(sql).toMatch(/create table public\.booster_champion_stats/)
    expect(sql).toMatch(/unique \(booster_id, account_type, champion\)/)
  })

  it('refresh_booster_performance_segments cobre as 6 combinações de GROUPING SETS esperadas', async () => {
    const sql = await migrationPromise
    // As 3 combinações originais (migration 054) continuam intocadas...
    expect(sql).toMatch(/\(o\.assigned_booster_id, o\.service_type, public\.rank_bucket_of\(o\.current_rank->>'tier'\)\)/)
    expect(sql).toMatch(/\(o\.assigned_booster_id, o\.service_type\)/)
    // ...mais as 3 novas por account_type.
    expect(sql).toMatch(/\(o\.assigned_booster_id, account_type\)/)
    expect(sql).toMatch(/\(o\.assigned_booster_id, account_type, public\.rank_bucket_of\(o\.current_rank->>'tier'\)\)/)
    expect(sql).toMatch(/\(o\.assigned_booster_id, account_type, o\.queue_type::text\)/)
  })
})
