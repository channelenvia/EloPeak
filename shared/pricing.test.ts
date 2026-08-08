import { describe, it, expect } from 'vitest'
import {
  computeOrderPrice, calcEloPrice, getEloDivPrice, getWinBoostPrice, getMd5WinPrice, applyLpModifier, lpModifierPct,
  estimateEloBoostHours, moneyToCents, centsToMoney, PLACEMENT_PRICE, applyCoupon, getClashBasePrice, CLASH_ESTIMATED_HOURS,
  type OrderPriceInput, type RankTier,
} from './pricing'

function baseInput(overrides: Partial<OrderPriceInput> = {}): OrderPriceInput {
  return {
    serviceType: 'elo_boost',
    queueType: 'solo_duo',
    boostMode: 'solo',
    currentRank: null,
    targetRank: null,
    currentLp: 0,
    avgLpGain: 20,
    avgLpLoss: 20, // ganho == perda => efficiencyMod neutro (1.0), preço previsível para os testes
    currentPdl: null,
    masterPlusPrice: null,
    winsPurchased: null,
    sessionsPurchased: null,
    extras: [],
    winPackage: null,
    coachPackagePrice: null,
    clashTier: null,
    couponCode: null,
    ...overrides,
  }
}

describe('Cálculo de addons — percentual sobre o preço base, não composto (seção 16)', () => {
  it('exemplo do enunciado: base R$100, Gameplay Explicativa 30% + Acesso Prioritário 15% = R$145', () => {
    const input = baseInput({
      currentRank: { tier: 'iron', division: 'I' },
      targetRank: { tier: 'bronze', division: 'IV' }, // 1 passo => 1x ELO_DIV_PRICE.iron = 11.05, não 100 — testamos a fórmula com um basePrice sintético abaixo
    })
    // Usamos o motor real de addons isoladamente: soma percentuais sobre um
    // basePrice conhecido, sem depender da tabela de rank por divisão.
    const priced = computeOrderPrice({
      ...input,
      extras: [
        { id: 'gameplay', priceModifier: 0, priceModifierPct: 30 },
        { id: 'priority', priceModifier: 0, priceModifierPct: 15 },
      ],
    })
    // extrasPrice = basePrice * 0.30 + basePrice * 0.15 (não composto)
    const expectedExtras = Math.round((priced.basePrice * 0.30 + priced.basePrice * 0.15) * 100) / 100
    expect(priced.extrasPrice).toBeCloseTo(expectedExtras, 2)
    expect(priced.totalPrice).toBeCloseTo(priced.basePrice + expectedExtras, 2)
  })

  it('addons não incidem uns sobre os outros (soma linear, nunca composta)', () => {
    const basePrice100Input = baseInput({ masterPlusPrice: 100, currentRank: { tier: 'master', division: null } })
    const priced = computeOrderPrice({
      ...basePrice100Input,
      extras: [
        { id: 'a', priceModifier: 0, priceModifierPct: 50 },
        { id: 'b', priceModifier: 0, priceModifierPct: 30 },
      ],
    })
    expect(priced.basePrice).toBe(100)
    // Composto seria 100 * 1.5 * 1.3 = 195 (errado). Linear é 100 + 50 + 30 = 180.
    expect(priced.extrasPrice).toBe(80)
    expect(priced.totalPrice).toBe(180)
  })
})

describe('Master+ — preço vem exclusivamente da tabela comercial (seção 14)', () => {
  it('usa masterPlusPrice diretamente como preço base quando informado', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
    }))
    expect(priced.basePrice).toBe(250)
    expect(priced.totalPrice).toBe(250)
  })

  it('preço fica zerado (pedido bloqueado) quando a faixa não tem preço configurado', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: null,
    }))
    expect(priced.basePrice).toBe(0)
    expect(priced.totalPrice).toBe(0)
  })

  it('Duo Boost nunca é aplicado ao preço do Master+ (defesa em profundidade)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
      boostMode: 'duo', // não deveria acontecer (validado antes na Edge Function), mas se acontecer:
    }))
    expect(priced.basePrice).toBe(0) // bloqueado, não "250 * 1.5"
  })

  it('estima Master até Challenger usando 30 PDL por partida, ultrapassando o alvo de 2200', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
      currentPdl: 100,
    }))
    // (2200-100)/30 = 70 partidas exatas fica EM 2200, não acima — precisa de
    // 71 pra ultrapassar. 71 * 0.5h * multiplicador 10 = 355.
    expect(priced.estimatedHours).toBe(355)
  })
})

describe('Estimativa dinâmica de entrega', () => {
  it('considera LP atual, ganho, perda, 80% de win rate e 30 minutos por partida', () => {
    expect(estimateEloBoostHours({
      currentRank: { tier: 'iron', division: 'IV' },
      targetRank: { tier: 'iron', division: 'III' },
      currentLp: 50,
      avgLpGain: 20,
      avgLpLoss: 10,
      currentPdl: null,
    })).toBe(2)
  })

  it('soma a subida padrão com o trecho Master+ ao mirar Grão-Mestre', () => {
    // Diamond I -> Master: 3 partidas (17 PDL líquido/partida, 50 PDL faltando).
    // Master (0 PDL) -> Grão-Mestre (alvo fixo 1200): 1200/30 = 40 exatas fica
    // EM 1200, precisa de 41 pra ultrapassar. Total: 3 + 41 = 44 partidas * 0.5h.
    expect(estimateEloBoostHours({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      currentLp: 50,
      avgLpGain: 25,
      avgLpLoss: 15,
      currentPdl: null,
    })).toBe(22)
  })

  it('usa o PDL atual em Master+ e a referência de 1200 para Grão-Mestre', () => {
    // (1200-900)/30 = 10 partidas exatas fica EM 1200, precisa de 11 pra
    // ultrapassar. 11 * 0.5h = 5.5.
    expect(estimateEloBoostHours({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'grandmaster', division: null },
      currentLp: 0,
      avgLpGain: 30,
      avgLpLoss: 30,
      currentPdl: 900,
    })).toBe(5.5)
  })

  it('Master+ nunca para exatamente NO corte -- mesmo quando falta menos de 30 PDL, ultrapassa por pelo menos 1', () => {
    // corte 1200, atual 1185: uma partida de 30 PDL chega a 1215 (ultrapassa
    // por 15) -- 1 partida basta, não fica preso tentando "acertar" o corte.
    expect(estimateEloBoostHours({
      currentRank: { tier: 'grandmaster', division: null },
      targetRank: { tier: 'challenger', division: null },
      currentLp: 0,
      avgLpGain: 30,
      avgLpLoss: 30,
      currentPdl: 1185,
      masterPlusCutoffs: { challenger: 1200 },
    })).toBe(0.5)
  })

  it('corte ao vivo (masterPlusCutoffs) substitui o alvo fixo quando disponível', () => {
    expect(estimateEloBoostHours({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'grandmaster', division: null },
      currentLp: 0,
      avgLpGain: 30,
      avgLpLoss: 30,
      currentPdl: 0,
      masterPlusCutoffs: { grandmaster: 60 },
    // corte ao vivo 60 (não o alvo fixo 1200): floor(60/30)+1 = 3 partidas.
    })).toBe(1.5)
  })
})

describe('Fluxo padrão (Iron–Diamond) — Duo aplica +50% sobre o preço com LP já modulado', () => {
  it('duo é exatamente 1.5x o preço solo equivalente', () => {
    const solo = computeOrderPrice(baseInput({
      currentRank: { tier: 'iron', division: 'IV' },
      targetRank: { tier: 'iron', division: 'I' },
      boostMode: 'solo',
    }))
    const duo = computeOrderPrice(baseInput({
      currentRank: { tier: 'iron', division: 'IV' },
      targetRank: { tier: 'iron', division: 'I' },
      boostMode: 'duo',
    }))
    // Comparação em centavos inteiros (mesma técnica de arredondamento do
    // código de produção) -- multiplicar o float solo.basePrice direto por
    // 1.5 pode cair num "empate" de meio centavo cujo arredondamento diverge
    // por erro de ponto flutuante, sem relação com nenhum bug de preço.
    expect(duo.basePrice).toBeCloseTo(centsToMoney(Math.round(moneyToCents(solo.basePrice) * 1.5)), 2)
  })

  it('rank alvo igual ou abaixo do atual não gera preço (calcEloPrice retorna 0)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'iron', division: 'IV' },
    }))
    expect(priced.basePrice).toBe(0)
  })
})

describe('Fluxo padrão mirando Master+ (Diamond- -> Grão-Mestre/Challenger direto)', () => {
  it('calcEloPrice para no degrau de Mestre -- não cobra taxa de divisão pelos degraus de GM/Challenger', () => {
    const toMaster = calcEloPrice('solo_duo', 'diamond', 'I', 'master', null)
    const toGrandmaster = calcEloPrice('solo_duo', 'diamond', 'I', 'grandmaster', null)
    const toChallenger = calcEloPrice('solo_duo', 'diamond', 'I', 'challenger', null)
    // Os 3 custam o mesmo por divisão -- o trecho Mestre->GM/Challenger tem
    // preço próprio (master_plus_pricing), somado por fora em computeOrderPrice.
    expect(toGrandmaster.price).toBe(toMaster.price)
    expect(toChallenger.price).toBe(toMaster.price)
  })

  it('soma o preço por divisão (até Mestre) com o preço do Master+ informado', () => {
    const { price: toMaster } = calcEloPrice('solo_duo', 'diamond', 'I', 'master', null)
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: 899.90,
    }))
    expect(priced.basePrice).toBeCloseTo(toMaster + 899.90, 2)
  })

  it('sem masterPlusPrice configurado pro alvo, bloqueia o pedido (basePrice zerado) em vez de inventar preço', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: null,
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('Duo Boost aplica +50% sobre o preço combinado (divisão + Master+), não só sobre o trecho de divisão', () => {
    const solo = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: 899.90,
      boostMode: 'solo',
    }))
    const duo = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: 899.90,
      boostMode: 'duo',
    }))
    expect(duo.basePrice).toBeCloseTo(Math.round(solo.basePrice * 1.5 * 100) / 100, 2)
  })

  it('alvo "master" exato não soma masterPlusPrice -- já coberto pelo preço por divisão', () => {
    const { price: expected } = calcEloPrice('solo_duo', 'diamond', 'I', 'master', null)
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'master', division: null },
      masterPlusPrice: null, // nem deveria ser consultado pra esse alvo
    }))
    expect(priced.basePrice).toBeCloseTo(expected, 2)
  })
})

describe('Integridade monetária e entradas hostis', () => {
  it('arredonda percentuais uma única vez na menor unidade monetária', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 10.01,
      extras: [{ id: 'fractional', priceModifier: 0, priceModifierPct: 15 }],
    }))
    expect(priced.extrasPrice).toBe(1.5)
    expect(priced.totalPrice).toBe(11.51)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01])(
    'recusa modificador monetário inválido: %s',
    (priceModifier) => {
      expect(() => computeOrderPrice(baseInput({
        currentRank: { tier: 'master', division: null },
        masterPlusPrice: 100,
        extras: [{ id: 'invalid', priceModifier, priceModifierPct: 0 }],
      }))).toThrow(RangeError)
    },
  )

  it('recusa percentual acima de 100%', () => {
    expect(() => computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      masterPlusPrice: 100,
      extras: [{ id: 'invalid', priceModifier: 0, priceModifierPct: 100.01 }],
    }))).toThrow(RangeError)
  })

  it.each([1, 3, 5])('calcula quantidade válida de vitórias: %i', (winsPurchased) => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'gold', division: 'II' },
      winsPurchased,
    }))
    expect(priced.basePrice).toBe(winsPurchased * 5.07)
    expect(priced.totalPrice).toBe(priced.basePrice)
  })

  it('rejeita quantidade de vitórias fora da faixa 1-5 (win_boost agora tem o mesmo cap do MD5)', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'gold', division: 'II' },
      winsPurchased: 50,
    }))
    expect(priced.basePrice).toBe(0)
    expect(priced.totalPrice).toBe(0)
  })

  it('limite exato de win_boost: 5 é válido, 6 é rejeitado (basePrice zerado)', () => {
    const validAtBoundary = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'gold', division: 'II' },
      winsPurchased: 5,
    }))
    expect(validAtBoundary.basePrice).toBe(5 * 5.07)

    const invalidAtBoundary = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'gold', division: 'II' },
      winsPurchased: 6,
    }))
    expect(invalidAtBoundary.basePrice).toBe(0)
  })

  it('calcula vitória avulsa Master+ com a tabela comercial atual', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'challenger', division: null },
      winsPurchased: 2,
    }))

    expect(priced.basePrice).toBe(259.74)
  })

  it('calcula MD5 proporcional ao pacote de 5 partidas com Master+', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'md5',
      currentRank: { tier: 'grandmaster', division: null },
      winsPurchased: 3,
    }))

    // grandmaster: Vitória Avulsa R$77,87/vitória com 50% de desconto = R$38,94/vitória
    expect(priced.basePrice).toBe(116.82)
  })

  it('recusa quantidade negativa (basePrice zerado, mesma faixa 1-5 do MD5)', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'gold', division: 'II' },
      winsPurchased: -1,
    }))
    expect(priced.basePrice).toBe(0)
  })
})

describe('MD5 — preço por vitória líquida (garantia de win rate nas placements)', () => {
  it('preço por vitória = preço da Vitória Avulsa com 50% de desconto, arredondado a 2 casas', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'md5',
      currentRank: { tier: 'gold', division: null },
      winsPurchased: 3,
    }))
    // Gold solo_duo: Vitória Avulsa R$5,07/vitória com 50% de desconto = R$2,54/vitória
    expect(priced.basePrice).toBeCloseTo(2.54 * 3, 2)
  })

  it('todos os 10 tiers derivam de getWinBoostPrice com 50% de desconto (solo_duo)', () => {
    const cases: [string, number][] = [
      ['iron', 1.89], ['bronze', 1.89], ['silver', 2.54], ['gold', 2.54],
      ['platinum', 4.49], ['emerald', 6.44], ['diamond', 10.34],
      ['master', 29.19], ['grandmaster', 38.94], ['challenger', 64.94],
    ]
    for (const [tier, perWinPrice] of cases) {
      const priced = computeOrderPrice(baseInput({
        serviceType: 'md5', currentRank: { tier: tier as RankTier, division: null }, winsPurchased: 1,
      }))
      expect(priced.basePrice).toBeCloseTo(perWinPrice, 2)
    }
  })

  it('sem winsPurchased ou currentRank, preço fica zero (pedido bloqueado)', () => {
    const priced = computeOrderPrice(baseInput({ serviceType: 'md5', currentRank: null, winsPurchased: null }))
    expect(priced.basePrice).toBe(0)
  })

  it('com currentRank válido mas sem winsPurchased (ou vice-versa), preço continua zero', () => {
    const semWins = computeOrderPrice(baseInput({
      serviceType: 'md5', currentRank: { tier: 'gold', division: null }, winsPurchased: null,
    }))
    expect(semWins.basePrice).toBe(0)

    const semRank = computeOrderPrice(baseInput({
      serviceType: 'md5', currentRank: null, winsPurchased: 3,
    }))
    expect(semRank.basePrice).toBe(0)
  })

  it('rejeita quantidade de vitórias fora da faixa 1-5 (garantia é só para as placements)', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'md5', currentRank: { tier: 'gold', division: null }, winsPurchased: 6,
    }))
    expect(priced.basePrice).toBe(0)
  })
})

describe('placement_matches (MD5 Completo, legado) — PLACEMENT_PRICE segue computável para pedidos antigos', () => {
  it('usa PLACEMENT_PRICE por tier, tabela independente da MD5 nova (por vitória)', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'placement_matches',
      currentRank: { tier: 'gold', division: null },
    }))
    expect(priced.basePrice).toBe(PLACEMENT_PRICE.gold)
    expect(priced.estimatedHours).toBe(25)
  })

  it('sem currentRank, preço fica zero (pedido bloqueado, mesma regra dos outros serviceTypes)', () => {
    const priced = computeOrderPrice(baseInput({ serviceType: 'placement_matches', currentRank: null }))
    expect(priced.basePrice).toBe(0)
  })
})

describe('Preços por fila — Vitória Avulsa', () => {
  const soloDuo: [RankTier, number][] = [
    ['iron', 377], ['bronze', 377], ['silver', 507], ['gold', 507], ['platinum', 897],
    ['emerald', 1287], ['diamond', 2067], ['master', 5837], ['grandmaster', 7787], ['challenger', 12987],
  ]
  const flex: [RankTier, number][] = [
    ['iron', 377], ['bronze', 377], ['silver', 507], ['gold', 507], ['platinum', 897],
    ['emerald', 1287], ['diamond', 2067], ['master', 5253], ['grandmaster', 7008], ['challenger', 11688],
  ]
  it.each(soloDuo)('solo_duo %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getWinBoostPrice('solo_duo', tier))).toBe(cents)
  })
  it.each(flex)('flex %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getWinBoostPrice('flex', tier))).toBe(cents)
  })
})

describe('Preços por fila — MD5 (garantia de win rate, por vitória — Vitória Avulsa com 50% de desconto)', () => {
  const soloDuo: [RankTier, number][] = [
    ['iron', 189], ['bronze', 189], ['silver', 254], ['gold', 254], ['platinum', 449],
    ['emerald', 644], ['diamond', 1034], ['master', 2919], ['grandmaster', 3894], ['challenger', 6494],
  ]
  const flex: [RankTier, number][] = [
    ['iron', 189], ['bronze', 189], ['silver', 254], ['gold', 254], ['platinum', 449],
    ['emerald', 644], ['diamond', 1034], ['master', 2627], ['grandmaster', 3504], ['challenger', 5844],
  ]
  it.each(soloDuo)('solo_duo %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getMd5WinPrice('solo_duo', tier))).toBe(cents)
  })
  it.each(flex)('flex %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getMd5WinPrice('flex', tier))).toBe(cents)
  })
})

describe('Preços por fila — Elo Boost (por divisão)', () => {
  // Iron..Diamond entry price per division, in cents.
  const soloDuo: [RankTier, number][] = [
    ['iron', 1105], ['bronze', 1287], ['silver', 1755], ['gold', 2197],
    ['platinum', 3107], ['emerald', 6097], ['diamond', 9737],
  ]
  // Flex deixou de ter desconto sobre solo_duo -- mesmos valores das duas filas.
  const flex: [RankTier, number][] = [
    ['iron', 1105], ['bronze', 1287], ['silver', 1755], ['gold', 2197],
    ['platinum', 3107], ['emerald', 6097], ['diamond', 9737],
  ]
  it.each(soloDuo)('solo_duo %s = %i centavos/divisão', (tier, cents) => {
    expect(moneyToCents(getEloDivPrice('solo_duo', tier))).toBe(cents)
  })
  it.each(flex)('flex %s = %i centavos/divisão', (tier, cents) => {
    expect(moneyToCents(getEloDivPrice('flex', tier))).toBe(cents)
  })
})

describe('Modificador de PDL — limiares corrigidos (15%/normal/-5%)', () => {
  it('19 PDL de média aplica +15%', () => {
    const withMod = applyLpModifier(100, 'gold', 0, 19)
    expect(withMod).toBeCloseTo(115, 2)
  })
  it('20 PDL de média é preço normal (limite inferior incluído)', () => {
    expect(applyLpModifier(100, 'gold', 0, 20)).toBeCloseTo(100, 2)
  })
  it('25 PDL de média é preço normal (limite superior incluído)', () => {
    expect(applyLpModifier(100, 'gold', 0, 25)).toBeCloseTo(100, 2)
  })
  it('26 PDL de média aplica -5%', () => {
    expect(applyLpModifier(100, 'gold', 0, 26)).toBeCloseTo(95, 2)
  })
})

describe('lpModifierPct — mesmos limiares expostos como percentual', () => {
  it('19 PDL de média => +15', () => {
    expect(lpModifierPct(19)).toBe(15)
  })
  it('20 PDL de média => 0 (limite inferior incluído)', () => {
    expect(lpModifierPct(20)).toBe(0)
  })
  it('25 PDL de média => 0 (limite superior incluído)', () => {
    expect(lpModifierPct(25)).toBe(0)
  })
  it('26 PDL de média => -5', () => {
    expect(lpModifierPct(26)).toBe(-5)
  })
})

describe('computeOrderPrice — pdlModifierPct exposto no resultado (fluxo padrão elo_boost)', () => {
  it.each([
    [19, 15],
    [20, 0],
    [25, 0],
    [26, -5],
  ])('avgLpGain=%i => pdlModifierPct=%i', (avgLpGain, expectedPct) => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'iron', division: 'IV' },
      targetRank: { tier: 'iron', division: 'I' },
      avgLpGain,
    }))
    expect(priced.pdlModifierPct).toBe(expectedPct)
  })

  it('Master+ nunca recebe o modificador de PDL (pdlModifierPct fica null)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
    }))
    expect(priced.pdlModifierPct).toBeNull()
  })

  it('win_boost nunca recebe o modificador de PDL (pdlModifierPct fica null)', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'gold', division: 'II' },
      winsPurchased: 3,
    }))
    expect(priced.pdlModifierPct).toBeNull()
  })

  it('md5 nunca recebe o modificador de PDL (pdlModifierPct fica null)', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'md5',
      currentRank: { tier: 'gold', division: null },
      winsPurchased: 3,
    }))
    expect(priced.pdlModifierPct).toBeNull()
  })

  it('coaching nunca recebe o modificador de PDL (pdlModifierPct fica null)', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'coaching',
      coachPackagePrice: 100,
      sessionsPurchased: 1,
    }))
    expect(priced.pdlModifierPct).toBeNull()
    expect(priced.estimatedHours).toBe(1)
  })

  it('multiplica por DELIVERY_ESTIMATE_MULTIPLIER a estimativa de horas de jogo puro nas estimativas de Vitória e MD5', () => {
    // 3 vitórias líquidas a 80% de win rate => ceil(3/0.8) = 4 partidas
    // esperadas (nem toda partida jogada é vitória). 4 * 0.5h * 10 = 20.
    const wins = computeOrderPrice(baseInput({
      serviceType: 'win_boost',
      currentRank: { tier: 'gold', division: 'II' },
      winsPurchased: 3,
    }))
    const md5 = computeOrderPrice(baseInput({
      serviceType: 'md5',
      currentRank: { tier: 'gold', division: null },
      winsPurchased: 3,
    }))

    expect(wins.estimatedHours).toBe(20)
    expect(md5.estimatedHours).toBe(20)
  })

  it('pacote de vitórias extra (addon) soma partidas pelo mesmo win rate, não 1 partida por vitória', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'iron', division: 'IV' },
      targetRank: { tier: 'iron', division: 'III' },
      currentLp: 50,
      avgLpGain: 20,
      avgLpLoss: 10,
      winPackage: 3,
    }))
    // Elo boost: 4 partidas (mesmo cálculo do teste "considera LP atual...").
    // + pacote de 3 vitórias: ceil(3/0.8) = 4 partidas. Total 8 * 0.5h * 10 = 40.
    expect(priced.estimatedHours).toBe(40)
  })
})

describe('Cupom de desconto (applyCoupon) — só ELOPEAK30, 30%, todo serviço de tabela menos coaching', () => {
  it('ELOPEAK30 aplica 30% de desconto para elo_boost/win_boost/md5/clash', () => {
    for (const serviceType of ['elo_boost', 'win_boost', 'md5', 'clash'] as const) {
      const result = applyCoupon(200, 'ELOPEAK30', serviceType)
      expect(result.couponApplied).toBe(true)
      expect(result.discountPct).toBe(30)
      expect(result.discountPrice).toBeCloseTo(60, 2)
    }
  })

  it('nunca aplica a coaching, mesmo com o código correto', () => {
    const result = applyCoupon(200, 'ELOPEAK30', 'coaching')
    expect(result.couponApplied).toBe(false)
    expect(result.discountPrice).toBe(0)
  })

  it('nunca aplica a placement_matches (legado, fora da whitelist de elegibilidade)', () => {
    const result = applyCoupon(200, 'ELOPEAK30', 'placement_matches')
    expect(result.couponApplied).toBe(false)
    expect(result.discountPrice).toBe(0)
  })

  it('aceita espaços ao redor (trim), mas exige a caixa exata', () => {
    const result = applyCoupon(200, '  ELOPEAK30  ', 'elo_boost')
    expect(result.couponApplied).toBe(true)
    expect(result.discountPrice).toBeCloseTo(60, 2)
  })

  it('é case-sensitive -- variações de caixa do código correto são rejeitadas', () => {
    for (const code of ['elopeak30', 'Elopeak30', 'ElopEAK30', 'ELOPEAk30']) {
      const result = applyCoupon(200, code, 'elo_boost')
      expect(result.couponApplied).toBe(false)
      expect(result.discountPrice).toBe(0)
    }
  })

  it('rejeita qualquer código que não seja ELOPEAK30 exatamente', () => {
    for (const code of ['ELOPEAK3', 'ELOPEAK300', 'ELOPEAK', 'ELOPEAK30X', 'PEAK30', ' ', '']) {
      const result = applyCoupon(200, code, 'elo_boost')
      expect(result.couponApplied).toBe(false)
      expect(result.discountPrice).toBe(0)
    }
  })

  it('rejeita null/undefined sem lançar', () => {
    expect(applyCoupon(200, null, 'elo_boost').couponApplied).toBe(false)
    expect(applyCoupon(200, undefined, 'elo_boost').couponApplied).toBe(false)
  })

  it('resiste a tentativas de poluição de protótipo (__proto__, constructor, toString)', () => {
    for (const code of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const result = applyCoupon(200, code, 'elo_boost')
      expect(result.couponApplied).toBe(false)
      expect(result.discountPrice).toBe(0)
    }
  })

  it('rejeita strings hostis/muito longas sem lançar', () => {
    const huge = 'A'.repeat(10_000)
    expect(() => applyCoupon(200, huge, 'elo_boost')).not.toThrow()
    expect(applyCoupon(200, huge, 'elo_boost').couponApplied).toBe(false)
  })

  it('computeOrderPrice aplica o desconto sobre basePrice + extrasPrice, arredondando uma única vez', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'iron', division: 'I' },
      targetRank: { tier: 'bronze', division: 'IV' },
      extras: [{ id: 'gameplay', priceModifier: 0, priceModifierPct: 30 }],
      couponCode: 'ELOPEAK30',
    }))
    const subtotal = priced.basePrice + priced.extrasPrice
    const expectedDiscount = Math.round(subtotal * 100 * 0.30) / 100
    expect(priced.couponApplied).toBe(true)
    expect(priced.discountPct).toBe(30)
    expect(priced.discountPrice).toBeCloseTo(expectedDiscount, 2)
    expect(priced.totalPrice).toBeCloseTo(subtotal - expectedDiscount, 2)
  })

  it('computeOrderPrice ignora o cupom em coaching -- totalPrice não muda', () => {
    const withoutCoupon = computeOrderPrice(baseInput({
      serviceType: 'coaching', coachPackagePrice: 100, sessionsPurchased: 1,
    }))
    const withCoupon = computeOrderPrice(baseInput({
      serviceType: 'coaching', coachPackagePrice: 100, sessionsPurchased: 1, couponCode: 'ELOPEAK30',
    }))
    expect(withCoupon.couponApplied).toBe(false)
    expect(withCoupon.discountPrice).toBe(0)
    expect(withCoupon.totalPrice).toBe(withoutCoupon.totalPrice)
  })

  it('sem couponCode, totalPrice é idêntico ao comportamento pré-cupom (basePrice + extrasPrice)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'iron', division: 'I' },
      targetRank: { tier: 'bronze', division: 'IV' },
    }))
    expect(priced.couponApplied).toBe(false)
    expect(priced.discountPrice).toBe(0)
    expect(priced.totalPrice).toBeCloseTo(priced.basePrice + priced.extrasPrice, 2)
  })
})

describe('Clash — preço fixo por modalidade × tier (seção 3 da spec)', () => {
  it.each([
    ['solo', 'tier_4', 26.00],
    ['solo', 'tier_3', 44.07],
    ['solo', 'tier_2', 51.87],
    ['solo', 'tier_1', 84.50],
    ['duo', 'tier_4', 77.87],
    ['duo', 'tier_3', 86.97],
    ['duo', 'tier_2', 130.00],
    ['duo', 'tier_1', 215.67],
  ] as const)('%s + %s = R$ %d', (mode, tier, expected) => {
    const priced = computeOrderPrice(baseInput({ serviceType: 'clash', boostMode: mode, clashTier: tier }))
    expect(priced.basePrice).toBeCloseTo(expected, 2)
    expect(priced.totalPrice).toBeCloseTo(expected, 2)
  })

  it('getClashBasePrice bate com a tabela de centavos', () => {
    expect(moneyToCents(getClashBasePrice('solo', 'tier_1'))).toBe(8450)
    expect(moneyToCents(getClashBasePrice('duo', 'tier_2'))).toBe(13000)
  })

  it('sem clashTier selecionado, preço fica 0 (pedido não avança)', () => {
    const priced = computeOrderPrice(baseInput({ serviceType: 'clash', clashTier: null }))
    expect(priced.basePrice).toBe(0)
  })

  it('estimatedHours é o valor fixo de uma noite de Clash, sem o multiplicador de entrega (mesma exceção do coaching)', () => {
    const priced = computeOrderPrice(baseInput({ serviceType: 'clash', clashTier: 'tier_2' }))
    expect(priced.estimatedHours).toBe(CLASH_ESTIMATED_HOURS)
  })

  it('Clash nunca recebe o modificador de PDL (pdlModifierPct fica null)', () => {
    const priced = computeOrderPrice(baseInput({ serviceType: 'clash', clashTier: 'tier_1' }))
    expect(priced.pdlModifierPct).toBeNull()
  })
})
