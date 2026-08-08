import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '..')
const migration = readFileSync(
  join(root, 'supabase', 'migrations_archive', '013_role_application_rls_hardening.sql'),
  'utf-8',
)

function functionBody(name: string): string {
  const escaped = name.replace('.', '\\.')
  const match = migration.match(new RegExp(`create or replace function\\s+${escaped}[\\s\\S]*?\\n\\$\\$;`, 'i'))
  expect(match).not.toBeNull()
  return match![0]
}

describe('security hardening migration 013', () => {
  it('request_booster_role não promove customer para booster', () => {
    const body = functionBody('public.request_booster_role')
    expect(body).not.toMatch(/update\s+public\.profiles[\s\S]*set\s+role\s*=\s*'booster'/i)
    expect(body).toContain("return jsonb_build_object('success', true)")
  })

  it('approve_booster é o único fluxo da migration que concede role booster após aprovação', () => {
    const body = functionBody('public.approve_booster')
    expect(body).toMatch(/case\s+when\s+v_status\s*=\s*'approved'\s+then\s+'booster'::public\.user_role/i)
    expect(body).toMatch(/where\s+id\s*=\s*v_booster_user_id[\s\S]*and\s+role\s+<>\s+'admin'/i)
  })

  it('onboard_booster permite candidatura sem role booster e não altera profiles.role', () => {
    const body = functionBody('public.onboard_booster')
    expect(body).toMatch(/v_role\s+not\s+in\s+\('customer',\s*'booster'\)/i)
    expect(body).not.toMatch(/update\s+public\.profiles[\s\S]*role/i)
  })

  it('policies de update por propriedade têm WITH CHECK de ownership', () => {
    expect(migration).toMatch(/customer_profiles_update_own[\s\S]*with check\s+\(user_id = auth\.uid\(\)\)/i)
    expect(migration).toMatch(/booster_profiles_update_own_or_admin[\s\S]*with check\s+\(user_id = auth\.uid\(\) or public\.is_admin\(\)\)/i)
    expect(migration).toMatch(/tickets_update[\s\S]*with check\s+\(customer_id = auth\.uid\(\) or public\.is_admin\(\)\)/i)
    expect(migration).toMatch(/notifications_update_own[\s\S]*with check\s+\(user_id = auth\.uid\(\)\)/i)
  })

  it('notifications têm trigger para impedir alteração de conteúdo/metadados por usuário comum', () => {
    expect(migration).toMatch(/create or replace function public\.trg_fn_guard_notifications_user_update\(\)/i)
    expect(migration).toMatch(/new\.type\s*:=\s*old\.type/i)
    expect(migration).toMatch(/new\.data\s*:=\s*old\.data/i)
  })

  it('update_order_status define máquina de estados para boosters e não permite estados terminais', () => {
    const body = functionBody('public.update_order_status')
    expect(body).toMatch(/v_order\.status = 'assigned'\s+and v_to_status = 'in_progress'/i)
    expect(body).toMatch(/v_order\.status = 'in_progress'\s+and v_to_status in \('paused', 'awaiting_customer'\)/i)
    expect(body).toMatch(/v_order\.status = 'paused'\s+and v_to_status in \('in_progress', 'awaiting_customer'\)/i)
    expect(body).toMatch(/v_order\.status = 'awaiting_customer'\s+and v_to_status in \('in_progress', 'paused'\)/i)
    expect(body).not.toMatch(/v_to_status in \([^)]*'completed'[^)]*\)/i)
    expect(body).not.toMatch(/v_to_status in \([^)]*'refunded'[^)]*\)/i)
    expect(body).not.toMatch(/v_to_status in \([^)]*'canceled'[^)]*\)/i)
  })
})
