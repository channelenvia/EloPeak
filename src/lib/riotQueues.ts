// IDs de fila da Riot (match-v5 queueId) -- só os que este app realmente
// produz partidas (Elo Boost/Vitórias/MD5/Clash rodam em SR 5x5; ARAM/URF
// aparecem quando o cliente joga uma partida avulsa durante o pedido).
// Ref.: https://static.developer.riotgames.com/docs/lol/queues.json
export const RIOT_QUEUE_LABEL: Record<number, string> = {
  400: 'Normal (Draft)',
  420: 'Ranqueada Solo/Duo',
  430: 'Normal (Blind)',
  440: 'Ranqueada Flex',
  450: 'ARAM',
  700: 'Clash',
  900: 'URF',
}

export function getQueueLabel(queueId: number | null): string {
  if (queueId == null) return 'Partida'
  return RIOT_QUEUE_LABEL[queueId] ?? 'Partida'
}
