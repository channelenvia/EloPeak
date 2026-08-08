import { localDateParts } from './timezone'

// Mesma janela usada pelo cron discord-top3-announcement (migration 156) e
// pelo gate do RPC request_payout (migration 158) -- saques só podem ser
// solicitados nos dias 15 e 30, sempre no fuso do negócio (não o do
// navegador do booster).
const WITHDRAWAL_TIMEZONE = 'America/Sao_Paulo'
const WITHDRAWAL_DAYS = [15, 30] as const

export function isWithdrawalWindowOpen(now: Date): boolean {
  return WITHDRAWAL_DAYS.includes(localDateParts(now, WITHDRAWAL_TIMEZONE).d as 15 | 30)
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

// Rótulo "dd/MM" do próximo dia 15 ou 30 a partir de hoje (incluindo hoje,
// se hoje já for um deles). Meses sem dia 30 (fevereiro) pulam pro dia 15
// do mês seguinte em vez de "vazar" pra março via overflow de Date.
export function nextWithdrawalDayLabel(now: Date): string {
  const start = localDateParts(now, WITHDRAWAL_TIMEZONE)
  let year = start.y
  let monthIndex0 = start.m - 1
  let minDay = start.d
  let day: number | undefined
  for (let guard = 0; guard < 24 && day === undefined; guard += 1) {
    const limit = daysInMonth(year, monthIndex0)
    day = WITHDRAWAL_DAYS.filter((wd) => wd <= limit).find((wd) => wd >= minDay)
    if (day === undefined) {
      monthIndex0 += 1
      if (monthIndex0 > 11) { monthIndex0 = 0; year += 1 }
      minDay = 1
    }
  }
  const target = new Date(Date.UTC(year, monthIndex0, day!))
  return target.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}
