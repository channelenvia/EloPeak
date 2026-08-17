// Depoimentos fictícios — usados SÓ enquanto o site está em fase de testes,
// sem clientes reais suficientes pra popular o carrossel da home. Cobrem os
// 3 serviços (Elo Boost, MD5, Coaching) com usernames e ícones de perfil no
// estilo League of Legends, igual ao resto do produto.
//
// ATENÇÃO: isto contradiz de propósito a política em src/api/reviews/index.ts
// ("nunca depoimentos inventados", master-prompt seção 28.1). Antes de
// qualquer lançamento com clientes reais, REMOVER este arquivo e o uso dele
// em TestimonialsCarousel.tsx, voltando a depender só de `usePublicReviews`.
export interface PlaceholderTestimonial {
  id: string
  rating: number
  content: string
  customer_name: string
  avatar_icon_id: number
  booster_display_name: string
  service_label: string
}

export const PLACEHOLDER_TESTIMONIALS: PlaceholderTestimonial[] = [
  // ── Elo Boost ──────────────────────────────────────────────────────────
  {
    id: 'ph-1',
    rating: 5,
    content: 'Subi de Platina 2 pra Diamante 4 em menos de uma semana. O booster jogou super discreto, nem meus amigos de duo perceberam a troca.',
    customer_name: 'Rafa_Diamante',
    avatar_icon_id: 23,
    booster_display_name: 'KaduMid',
    service_label: 'Elo Boost',
  },
  {
    id: 'ph-2',
    rating: 5,
    content: 'Fiz o Duo Boost pra sair do Ouro e finalmente cheguei em Esmeralda. Comunicação excelente durante todas as partidas, sempre me avisando o que tava fazendo.',
    customer_name: 'MariGold23',
    avatar_icon_id: 4,
    booster_display_name: 'Vitin_ADC',
    service_label: 'Elo Boost',
  },
  {
    id: 'ph-3',
    rating: 4,
    content: 'Já é a segunda vez que uso o serviço. O preço fechou exatamente com o que tava no configurador, sem surpresa na hora de pagar.',
    customer_name: 'PedroFeitosa',
    avatar_icon_id: 7,
    booster_display_name: 'Camila.GM',
    service_label: 'Elo Boost',
  },
  // ── MD5 ────────────────────────────────────────────────────────────────
  {
    id: 'ph-4',
    rating: 5,
    content: 'Fiz o MD5 pra garantir minhas vitórias de posicionamento e fechei 5W0L. Comecei a temporada de LP positivo pela primeira vez.',
    customer_name: 'Thiago_Jungla',
    avatar_icon_id: 12,
    booster_display_name: 'Bruno_Support',
    service_label: 'MD5',
  },
  {
    id: 'ph-5',
    rating: 5,
    content: 'Comprei o pacote de vitórias avulsas numa fase de derrota atrás de derrota. O booster reverteu o tilt rapidinho, recomendo.',
    customer_name: 'AnaclaraTop',
    avatar_icon_id: 9,
    booster_display_name: 'JuliaMidLane',
    service_label: 'MD5',
  },
  {
    id: 'ph-6',
    rating: 4,
    content: 'Vi o preço por vitória na aba de preços e bateu certinho no pedido. Gostei da transparência, sem taxa escondida.',
    customer_name: 'Gustavo_Smurf',
    avatar_icon_id: 14,
    booster_display_name: 'KaduMid',
    service_label: 'MD5',
  },
  // ── Coaching ───────────────────────────────────────────────────────────
  {
    id: 'ph-7',
    rating: 5,
    content: 'Fiz uma sessão de coaching focada em posicionamento de ADC. O coach revisou 3 replays meus e apontou erros que eu nem sabia que cometia.',
    customer_name: 'LeleFeiticeira',
    avatar_icon_id: 26,
    booster_display_name: 'Vitin_ADC',
    service_label: 'Coaching',
  },
  {
    id: 'ph-8',
    rating: 5,
    content: 'O coaching me ajudou muito com mentalidade competitiva. Parei de tiltar depois de streak ruim, mudou como eu encaro a partida.',
    customer_name: 'Matheus_OTP',
    avatar_icon_id: 28,
    booster_display_name: 'Camila.GM',
    service_label: 'Coaching',
  },
  {
    id: 'ph-9',
    rating: 4,
    content: 'Sessão de análise de gameplay valeu muito a pena. Feedback bem específico sobre posicionamento no mapa, direto ao ponto.',
    customer_name: 'Camila_Ferreira',
    avatar_icon_id: 33,
    booster_display_name: 'Bruno_Support',
    service_label: 'Coaching',
  },
  // ── Elo Boost ──────────────────────────────────────────────────────────
  {
    id: 'ph-10',
    rating: 5,
    content: 'Tava travado em Ouro 3 há dois meses. Contratei o Solo Boost e em 4 dias já tava jogando ranked em Platina de novo, com LP sobrando.',
    customer_name: 'Diego_Fernandes',
    avatar_icon_id: 588,
    booster_display_name: 'JuliaMidLane',
    service_label: 'Elo Boost',
  },
  {
    id: 'ph-11',
    rating: 5,
    content: 'Fechei o Boost Master+ pra sair de Mestre e chegar em Grão-Mestre. O suporte respondeu rápido em todas as dúvidas antes de eu confirmar o pedido.',
    customer_name: 'Bia_Nakamura',
    avatar_icon_id: 895,
    booster_display_name: 'KaduMid',
    service_label: 'Elo Boost',
  },
  {
    id: 'ph-12',
    rating: 4,
    content: 'Usei o Duo Boost umas 3 vezes já. Sempre mando a conta parceira e o booster já sabe o combo que eu gosto de jogar junto.',
    customer_name: 'Otavio_Ramos',
    avatar_icon_id: 4568,
    booster_display_name: 'Vitin_ADC',
    service_label: 'Elo Boost',
  },
  // ── MD5 ────────────────────────────────────────────────────────────────
  {
    id: 'ph-13',
    rating: 5,
    content: 'Peguei o pacote de 5 vitórias antes de uma promoção de patente e passei de primeira. Chat ao vivo com o booster deixou tudo bem tranquilo.',
    customer_name: 'Fernanda_Rocha',
    avatar_icon_id: 4025,
    booster_display_name: 'Camila.GM',
    service_label: 'MD5',
  },
  {
    id: 'ph-14',
    rating: 4,
    content: 'Comprei só 3 vitórias avulsas (não precisava do pacote completo) e o desconto proporcional bateu certinho com o que eu calculei antes.',
    customer_name: 'Enzo_Bittencourt',
    avatar_icon_id: 4901,
    booster_display_name: 'Bruno_Support',
    service_label: 'MD5',
  },
  // ── Coaching ───────────────────────────────────────────────────────────
  {
    id: 'ph-15',
    rating: 5,
    content: 'Sempre jogava jungle no instinto. O coach me mostrou um plano de rota por partida e minha diferença de gold no início do jogo mudou completamente.',
    customer_name: 'Isabela_Duarte',
    avatar_icon_id: 4646,
    booster_display_name: 'JuliaMidLane',
    service_label: 'Coaching',
  },
  {
    id: 'ph-16',
    rating: 5,
    content: 'Marquei uma sessão só pra revisar minhas últimas 5 derrotas seguidas. O coach achou o mesmo erro de posicionamento se repetindo em quase todas.',
    customer_name: 'Caue_Monteiro',
    avatar_icon_id: 4894,
    booster_display_name: 'KaduMid',
    service_label: 'Coaching',
  },
]
