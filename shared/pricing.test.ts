import { describe, it, expect } from 'vitest'
import {
  computeOrderPrice, calcEloPrice, getEloDivPrice, getWinBoostPrice, getMd5WinPrice, applyLpModifier, lpModifierPct,
  applyMasterPlusPdlDiscount, estimateEloBoostHours, moneyToCents, PLACEMENT_PRICE, applyCoupon,
  getClashBasePrice, CLASH_ESTIMATED_HOURS,
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
    avgPdlGain: null,
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
      targetRank: { tier: 'bronze', division: 'IV' }, // 1 passo => 1x ELO_DIV_PRICE.iron = 10.90, não 100 — testamos a fórmula com um basePrice sintético abaixo
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
  it('usa masterPlusPrice como preço base, com o desconto fixo do trecho Mestre->alvo já aplicado', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
    }))
    const expected = applyMasterPlusPdlDiscount(250, 'challenger', 0, 'master', 'solo_duo')
    expect(priced.basePrice).toBe(expected)
    expect(priced.totalPrice).toBe(expected)
  })

  it('0 PDL atual => sem desconto, cobra o valor cheio', () => {
    expect(applyMasterPlusPdlDiscount(1119.17, 'grandmaster', 0, 'master', 'solo_duo')).toBe(1119.17)
  })

  it('desconto é floor(PDL atual / 50) vitórias, não a distância até o corte -- Mestre 200 PDL indo pra Grão-Mestre desconta 4 vitórias', () => {
    // floor(200/50) = 4 -- desconta 4 * (preço da Vitória Avulsa em Mestre, R$58,30) * 5% = R$11,66.
    const result = applyMasterPlusPdlDiscount(1119.17, 'grandmaster', 200, 'master', 'solo_duo')
    expect(result).toBeCloseTo(1119.17 - 4 * 58.30 * 0.05, 2)
    expect(result).toBeCloseTo(1107.51, 2)
  })

  it('49 PDL atual ainda arredonda pra baixo => 0 vitórias de desconto (mesmo preço de 0 PDL)', () => {
    expect(applyMasterPlusPdlDiscount(1119.17, 'grandmaster', 49, 'master', 'solo_duo')).toBe(1119.17)
  })

  it('50 PDL atual já desconta exatamente 1 vitória', () => {
    // 1 * 5830 centavos * 5% = 291.5 centavos, arredonda pra 292 (R$2,92) --
    // arredondamento único na menor unidade monetária, mesma convenção do
    // resto do módulo (moneyToCents/centsToMoney).
    const result = applyMasterPlusPdlDiscount(1119.17, 'grandmaster', 50, 'master', 'solo_duo')
    expect(result).toBeCloseTo(1116.25, 2)
  })

  it('desconto nunca deixa o preço negativo mesmo com PDL muito alto', () => {
    const result = applyMasterPlusPdlDiscount(10, 'grandmaster', 100_000, 'master', 'solo_duo')
    expect(result).toBe(0)
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

  it('Duo Boost é sempre bloqueado no Master+, mesmo Mestre mirando Grão-Mestre (Riot liberava Duo até lá antes)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: 1119.17,
      boostMode: 'duo',
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('Duo Boost continua bloqueado (price 0) quando o alvo é Challenger, mesmo vindo de Master', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'master', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
      boostMode: 'duo',
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('Duo Boost continua bloqueado (price 0) a partir de Grão-Mestre (defesa em profundidade)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'grandmaster', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
      // Não deveria acontecer (validado antes na Edge Function/getBoostFlow),
      // mas se acontecer o preço fica zerado, nunca inflado.
      boostMode: 'duo',
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('na fila Flex, Duo Boost também é bloqueado no Master+ (a exceção de fila não existe mais para Elo Boost)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'grandmaster', division: null },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 250,
      boostMode: 'duo',
      queueType: 'flex',
    }))
    expect(priced.basePrice).toBe(0)
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

describe('Fluxo padrão (Iron–Diamond) — Duo usa tabela própria por divisão', () => {
  it('duo usa a tabela de duo por divisão, não um percentual sobre o solo', () => {
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
    // Iron IV -> Iron I é 3 degraus dentro do mesmo tier.
    expect(solo.basePrice).toBeCloseTo(10.90 * 3, 2)
    expect(duo.basePrice).toBeCloseTo(20.90 * 3, 2)
  })

  it('rank alvo igual ou abaixo do atual não gera preço (calcEloPrice retorna 0)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'iron', division: 'IV' },
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('subir um tier inteiro (IV até entrar no próximo tier) custa exatamente 4x o preço por divisão do tier de ORIGEM, nunca 3x origem + 1x destino', () => {
    // Ferro IV -> Bronze IV: os 4 degraus (III, II, I, Bronze IV) são todos
    // cobrados na tabela do Ferro (tier de origem) -- bate com "tier
    // completo" da tabela (R$43,60), não R$45,60 (3x10.90 + 1x12.90).
    const { price: ironToBronze } = calcEloPrice('solo_duo', 'solo', 'iron', 'IV', 'bronze', 'IV')
    expect(ironToBronze).toBeCloseTo(10.90 * 4, 2)
    expect(ironToBronze).toBeCloseTo(43.60, 2)

    const { price: bronzeToSilver } = calcEloPrice('solo_duo', 'solo', 'bronze', 'IV', 'silver', 'IV')
    expect(bronzeToSilver).toBeCloseTo(12.90 * 4, 2)
    expect(bronzeToSilver).toBeCloseTo(51.60, 2)

    const { price: diamondToMaster } = calcEloPrice('solo_duo', 'solo', 'diamond', 'IV', 'master', null)
    expect(diamondToMaster).toBeCloseTo(102.90 * 4, 2)
    expect(diamondToMaster).toBeCloseTo(411.60, 2)
  })

  it('cada "tier completo" solo da tabela bate exatamente com Ferro IV -> Mestre acumulado', () => {
    // Soma de todos os "tier completo" Ferro..Diamante = preço de Ferro IV -> Mestre.
    const perTierComplete = [43.60, 51.60, 67.60, 87.60, 127.60, 251.60, 411.60]
    const { price } = calcEloPrice('solo_duo', 'solo', 'iron', 'IV', 'master', null)
    expect(price).toBeCloseTo(perTierComplete.reduce((a, b) => a + b, 0), 2)
  })
})

describe('Fluxo padrão mirando Master+ (Diamond- -> Grão-Mestre/Challenger direto)', () => {
  it('calcEloPrice para no degrau de Mestre -- não cobra taxa de divisão pelos degraus de GM/Challenger', () => {
    const toMaster = calcEloPrice('solo_duo', 'solo', 'diamond', 'I', 'master', null)
    const toGrandmaster = calcEloPrice('solo_duo', 'solo', 'diamond', 'I', 'grandmaster', null)
    const toChallenger = calcEloPrice('solo_duo', 'solo', 'diamond', 'I', 'challenger', null)
    // Os 3 custam o mesmo por divisão -- o trecho Mestre->GM/Challenger tem
    // preço próprio (master_plus_pricing), somado por fora em computeOrderPrice.
    expect(toGrandmaster.price).toBe(toMaster.price)
    expect(toChallenger.price).toBe(toMaster.price)
  })

  it('soma o preço por divisão (até Mestre) com o preço do Master+ informado, descontado pelo rank atual (Diamond)', () => {
    const { price: toMaster } = calcEloPrice('solo_duo', 'solo', 'diamond', 'I', 'master', null)
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: 1119.17,
    }))
    const discountedMasterPlus = applyMasterPlusPdlDiscount(1119.17, 'grandmaster', 0, 'diamond', 'solo_duo')
    expect(priced.basePrice).toBeCloseTo(toMaster + discountedMasterPlus, 2)
  })

  it('desconto do trecho Mestre->alvo usa o win price do rank ATUAL (Diamond), não o de Mestre -- mesma fórmula do fluxo Master+ puro, só troca a tabela de referência', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: 1119.17,
    }))
    const { price: toMaster } = calcEloPrice('solo_duo', 'solo', 'diamond', 'I', 'master', null)
    const masterPlusSegment = priced.basePrice - toMaster
    // Desconto real aplicado ao trecho tem que ser estritamente menor que o
    // preço cheio informado -- prova que o desconto está de fato entrando no
    // cálculo pra pedidos que partem de Diamond-.
    expect(masterPlusSegment).toBeLessThan(1119.17)
    // E tem que bater com o preço da Vitória Avulsa em Diamond, não em Mestre
    // (o rank ATUAL da conta é Diamond nesse pedido).
    const diamondWinValue = moneyToCents(getWinBoostPrice('solo_duo', 'diamond', 'solo'))
    const masterWinValue = moneyToCents(getWinBoostPrice('solo_duo', 'master', 'solo'))
    expect(diamondWinValue).not.toBe(masterWinValue)
    const expectedSegment = applyMasterPlusPdlDiscount(1119.17, 'grandmaster', 0, 'diamond', 'solo_duo')
    expect(masterPlusSegment).toBeCloseTo(expectedSegment, 2)
  })

  it('sem masterPlusPrice configurado pro alvo, bloqueia o pedido (basePrice zerado) em vez de inventar preço', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: null,
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('Duo Boost bloqueado (price 0) quando o alvo é Grão-Mestre, a partir de um rank padrão (Diamond) -- Duo é Iron-Diamond only agora', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'grandmaster', division: null },
      masterPlusPrice: 1119.17,
      boostMode: 'duo',
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('Duo Boost bloqueado (price 0) quando o alvo é Challenger, mesmo vindo de um rank padrão (Diamond)', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 2718.04,
      boostMode: 'duo',
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('na fila Flex, Duo Boost também é bloqueado com alvo Master+ a partir de um rank padrão (Diamond) -- a exceção de fila não existe mais', () => {
    const priced = computeOrderPrice(baseInput({
      currentRank: { tier: 'diamond', division: 'I' },
      targetRank: { tier: 'challenger', division: null },
      masterPlusPrice: 2718.04,
      boostMode: 'duo',
      queueType: 'flex',
    }))
    expect(priced.basePrice).toBe(0)
  })

  it('alvo "master" exato não soma masterPlusPrice -- já coberto pelo preço por divisão', () => {
    const { price: expected } = calcEloPrice('solo_duo', 'solo', 'diamond', 'I', 'master', null)
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
      targetRank: null, // sem alvo -- masterPlusPrice fica intacto, sem o desconto do trecho Mestre->alvo
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
    expect(priced.basePrice).toBeCloseTo(winsPurchased * 5.67, 2)
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
    expect(validAtBoundary.basePrice).toBe(5 * 5.67)

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

    expect(priced.basePrice).toBe(288.80)
  })

  it('calcula MD5 proporcional ao pacote de 5 partidas com Master+', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'md5',
      currentRank: { tier: 'grandmaster', division: null },
      winsPurchased: 3,
    }))

    // grandmaster: MD5 é tabela própria agora, R$29,90/vitória.
    expect(priced.basePrice).toBe(89.70)
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
  it('MD5 usa tabela própria por tier, independente da Vitória Avulsa', () => {
    const priced = computeOrderPrice(baseInput({
      serviceType: 'md5',
      currentRank: { tier: 'gold', division: null },
      winsPurchased: 3,
    }))
    // Gold solo: MD5 R$5,98/vitória (tabela própria, não derivada do Win Boost).
    expect(priced.basePrice).toBeCloseTo(5.98 * 3, 2)
  })

  it('todos os 10 tiers usam a tabela própria de MD5 (solo, solo_duo)', () => {
    const cases: [string, number][] = [
      ['iron', 3.80], ['bronze', 4.50], ['silver', 5.09], ['gold', 5.98],
      ['platinum', 8.25], ['emerald', 10.11], ['diamond', 10.98],
      ['master', 16.02], ['grandmaster', 29.90], ['challenger', 47.88],
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
  const solo: [RankTier, number][] = [
    ['iron', 458], ['bronze', 458], ['silver', 479], ['gold', 567], ['platinum', 930],
    ['emerald', 1315], ['diamond', 1685], ['master', 5830], ['grandmaster', 8620], ['challenger', 14440],
  ]
  const duo: [RankTier, number][] = [
    ['iron', 605], ['bronze', 605], ['silver', 795], ['gold', 929], ['platinum', 1085],
    ['emerald', 2005], ['diamond', 2995], ['master', 8515],
  ]
  it.each(solo)('solo_duo solo %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getWinBoostPrice('solo_duo', tier, 'solo'))).toBe(cents)
  })
  it.each(solo)('flex solo %s = %i centavos (Flex espelha Solo/Duo)', (tier, cents) => {
    expect(moneyToCents(getWinBoostPrice('flex', tier, 'solo'))).toBe(cents)
  })
  it.each(duo)('solo_duo duo %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getWinBoostPrice('solo_duo', tier, 'duo'))).toBe(cents)
  })
  it.each(duo)('flex duo %s = %i centavos (Flex espelha Solo/Duo)', (tier, cents) => {
    expect(moneyToCents(getWinBoostPrice('flex', tier, 'duo'))).toBe(cents)
  })
})

describe('Preços por fila — MD5 (tabela própria por vitória líquida)', () => {
  const solo: [RankTier, number][] = [
    ['iron', 380], ['bronze', 450], ['silver', 509], ['gold', 598], ['platinum', 825],
    ['emerald', 1011], ['diamond', 1098], ['master', 1602], ['grandmaster', 2990], ['challenger', 4788],
  ]
  const duo: [RankTier, number][] = [
    ['iron', 540], ['bronze', 628], ['silver', 726], ['gold', 809], ['platinum', 953],
    ['emerald', 1498], ['diamond', 1999], ['master', 3350],
  ]
  it.each(solo)('solo_duo solo %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getMd5WinPrice('solo_duo', tier, 'solo'))).toBe(cents)
  })
  it.each(solo)('flex solo %s = %i centavos (Flex espelha Solo/Duo)', (tier, cents) => {
    expect(moneyToCents(getMd5WinPrice('flex', tier, 'solo'))).toBe(cents)
  })
  it.each(duo)('solo_duo duo %s = %i centavos', (tier, cents) => {
    expect(moneyToCents(getMd5WinPrice('solo_duo', tier, 'duo'))).toBe(cents)
  })
  it.each(duo)('flex duo %s = %i centavos (Flex espelha Solo/Duo)', (tier, cents) => {
    expect(moneyToCents(getMd5WinPrice('flex', tier, 'duo'))).toBe(cents)
  })
})

describe('Preços por fila — Elo Boost (por divisão)', () => {
  const solo: [RankTier, number][] = [
    ['iron', 1090], ['bronze', 1290], ['silver', 1690], ['gold', 2190],
    ['platinum', 3190], ['emerald', 6290], ['diamond', 10290],
  ]
  const duo: [RankTier, number][] = [
    ['iron', 2090], ['bronze', 2390], ['silver', 2690], ['gold', 3290],
    ['platinum', 4890], ['emerald', 9890], ['diamond', 15790],
  ]
  it.each(solo)('solo_duo solo %s = %i centavos/divisão', (tier, cents) => {
    expect(moneyToCents(getEloDivPrice('solo_duo', tier, 'solo'))).toBe(cents)
  })
  it.each(solo)('flex solo %s = %i centavos/divisão (Flex espelha Solo/Duo)', (tier, cents) => {
    expect(moneyToCents(getEloDivPrice('flex', tier, 'solo'))).toBe(cents)
  })
  it.each(duo)('solo_duo duo %s = %i centavos/divisão', (tier, cents) => {
    expect(moneyToCents(getEloDivPrice('solo_duo', tier, 'duo'))).toBe(cents)
  })
  it.each(duo)('flex duo %s = %i centavos/divisão (Flex espelha Solo/Duo)', (tier, cents) => {
    expect(moneyToCents(getEloDivPrice('flex', tier, 'duo'))).toBe(cents)
  })
})

describe('Modificador de PDL — limiar único (10%/normal)', () => {
  it('19 PDL de média aplica +10%', () => {
    const withMod = applyLpModifier(100, 'gold', 0, 19)
    expect(withMod).toBeCloseTo(110, 2)
  })
  it('20 PDL de média é preço normal (limite incluído)', () => {
    expect(applyLpModifier(100, 'gold', 0, 20)).toBeCloseTo(100, 2)
  })
  it('30 PDL de média continua preço normal (não há mais desconto acima de 25)', () => {
    expect(applyLpModifier(100, 'gold', 0, 30)).toBeCloseTo(100, 2)
  })
})

describe('Desconto por vitória já banked no LP atual (Iron–Diamond) — não é proporcional à divisão inteira', () => {
  it('0 LP atual => sem desconto nenhum, preço cheio', () => {
    expect(applyLpModifier(102.90, 'diamond', 0, 22)).toBe(102.90)
  })

  it('exemplo real: Diamante III 23 LP atual, média 22 -- 1 vitória banked, desconta 5% da Vitória Avulsa em Diamante', () => {
    // floor(23/22) = 1 vitória banked. Vitória Avulsa solo em Diamante =
    // R$16,85 -> 5% = R$0,8425, arredonda pra R$0,84 (centavo mais próximo).
    const { price: fullPrice } = calcEloPrice('solo_duo', 'solo', 'diamond', 'III', 'diamond', 'II')
    expect(fullPrice).toBeCloseTo(102.90, 2)
    const result = applyLpModifier(fullPrice, 'diamond', 23, 22, undefined, 'solo_duo', 'solo')
    expect(result).toBeCloseTo(102.06, 2)
  })

  it('LP atual menor que a média => 0 vitórias banked, sem desconto (mesmo com LP > 0)', () => {
    // 15 LP atual, média 22 -- floor(15/22) = 0, nenhuma vitória completa banked.
    expect(applyLpModifier(102.90, 'diamond', 15, 22)).toBe(102.90)
  })

  it('2 vitórias banked desconta 2x o valor de uma Vitória Avulsa no tier atual', () => {
    // Gold: 60 LP atual, média 25 -- floor(60/25) = 2. Vitória Avulsa Gold R$5,67 -> 5% = R$0,2835/vitória.
    const result = applyLpModifier(100, 'gold', 60, 25)
    expect(result).toBeCloseTo(100 - 2 * 5.67 * 0.05, 2)
  })

  it('desconto usa a tabela de Duo quando o boost é Duo, não a de Solo', () => {
    const solo = applyLpModifier(100, 'gold', 25, 25, undefined, 'solo_duo', 'solo')
    const duo = applyLpModifier(100, 'gold', 25, 25, undefined, 'solo_duo', 'duo')
    // Vitória Avulsa Gold: solo R$5,67, duo R$9,29 -- descontos diferentes.
    expect(solo).not.toBe(duo)
    expect(duo).toBeCloseTo(100 - 1 * 9.29 * 0.05, 2)
  })

  it('desconto por LP banked e o modificador de +10%/normal se combinam (desconta primeiro, depois aplica o percentual)', () => {
    // Iron: 15 LP atual, média 19 (< 20 => +10%) -- floor(15/19) = 0 vitórias banked aqui,
    // então só o +10% se aplica.
    expect(applyLpModifier(100, 'iron', 15, 19)).toBeCloseTo(110, 2)
  })

  it('desconto nunca deixa o preço negativo mesmo com muitas vitórias banked', () => {
    // 99 LP atual, média 1 -- floor(99/1) = 99 vitórias, desconto estourado.
    expect(applyLpModifier(1, 'iron', 99, 1)).toBe(0)
  })
})

describe('lpModifierPct — limiar único exposto como percentual', () => {
  it('19 PDL de média => 10', () => {
    expect(lpModifierPct(19)).toBe(10)
  })
  it('20 PDL de média => 0 (limite incluído)', () => {
    expect(lpModifierPct(20)).toBe(0)
  })
  it('30 PDL de média => 0 (não há mais desconto acima de 25)', () => {
    expect(lpModifierPct(30)).toBe(0)
  })
})

describe('computeOrderPrice — pdlModifierPct exposto no resultado (fluxo padrão elo_boost)', () => {
  it.each([
    [19, 10],
    [20, 0],
    [25, 0],
    [30, 0],
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
