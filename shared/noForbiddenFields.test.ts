import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MASTER_PLUS_FORBIDDEN_FIELDS } from './boostDomain'

// Verificação estática: "PDL alvo" (targetLp/target_lp/targetPdl/target_pdl)
// não deve existir em nenhuma camada do fluxo Master+ — nem estado, nem
// schema, nem payload. Isso não é um teste de comportamento em runtime (não
// substitui rodar a Edge Function de verdade — ver relatório final sobre a
// indisponibilidade do Supabase local neste ambiente), mas garante que o
// campo não foi só ocultado na UI enquanto continua vivo em algum lugar.
const root = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(root, relPath), 'utf-8')
}

describe('Ausência estrutural de PDL alvo no Master+', () => {
  // boostDomain.ts fica de fora: é o arquivo que DEFINE MASTER_PLUS_FORBIDDEN_FIELDS,
  // então contém os literais das strings proibidas por definição.
  const filesToCheck = [
    'src/stores/orderBuilderStore.ts',
    'src/features/customer/order-builder/StepConfigure.tsx',
    'src/features/customer/order-builder/StepReview.tsx',
    'src/features/customer/order-builder/StepPayment.tsx',
    'src/features/customer/order-builder/StepExtras.tsx',
  ]

  for (const file of filesToCheck) {
    it(`${file} não contém targetLp/target_lp/targetPdl/target_pdl`, () => {
      const content = read(file)
      for (const forbidden of MASTER_PLUS_FORBIDDEN_FIELDS) {
        expect(content).not.toContain(forbidden)
      }
    })
  }

  it('a Edge Function não declara target_lp nem target_pdl como campo no schema Master+', () => {
    // masterPlusIntentSchema vive em _shared/orderPricing.ts (extraído de
    // create-pix-payment/index.ts — ver Task 4/order-quote), reutilizado por
    // create-pix-payment e order-quote.
    const content = read('supabase/functions/_shared/orderPricing.ts')
    // Isola só a declaração do objeto Zod (até o `})` de fechamento), sem
    // arrastar comentários de código seguinte que apenas mencionam o termo.
    const start = content.indexOf('const masterPlusIntentSchema')
    const end = content.indexOf('.strict()', start) + '.strict()'.length
    const block = content.slice(start, end)
    // Procura por declaração de CAMPO (identificador seguido de ':'), não por
    // qualquer ocorrência da palavra em prosa/comentário.
    expect(block).not.toMatch(/\b(target_lp|target_pdl|targetLp|targetPdl)\s*:/)
    expect(block).toMatch(/\.strict\(\)/)
  })

  it('o schema Master+ ainda aceita boost_mode "duo" na forma (a rejeição acontece antes, na roteação de fluxo -- ver teste abaixo)', () => {
    const content = read('supabase/functions/_shared/orderPricing.ts')
    const start = content.indexOf('const masterPlusIntentSchema')
    const end = content.indexOf('\nconst ', start + 10)
    const block = content.slice(start, end === -1 ? undefined : end)
    expect(block).toMatch(/boost_mode:\s*z\.enum\(\['solo', 'duo'\]\)/)
  })

  it('a roteação de fluxo bloqueia Duo Boost incondicionalmente no Master+ (Elo Boost Duo é Iron-Diamond only)', () => {
    const content = read('supabase/functions/_shared/orderPricing.ts')
    expect(content).toMatch(/routed\.data\.boost_mode === 'duo'/)
  })
})
