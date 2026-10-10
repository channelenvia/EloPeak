import { localDateParts } from './timezone'

// Mesma janela do RPC request_payout (is_payout_window_day) e dos crons de Top 3 e
// lembrete de saque: dia 15 e ULTIMO dia do mes (vale como "dia 30"), sempre no
// fuso do negocio (nao o do navegador do booster).
const WITHDRAWAL_TIMEZONE = 'America/Sao_Paulo'
const MID_MONTH_DAY = 15

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

export function isWithdrawalWindowOpen(now: Date): boolean {
  const { y, m, d } = localDateParts(now, WITHDRAWAL_TIMEZONE)
  return d === MID_MONTH_DAY || d === daysInMonth(y, m - 1)
}

// Rotulo "dd/MM" do proximo dia de saque a partir de hoje (inclusive).
export function nextWithdrawalDayLabel(now: Date): string {
  const { y, m, d } = localDateParts(now, WITHDRAWAL_TIMEZONE)
  const last = daysInMonth(y, m - 1)
  const day = [MID_MONTH_DAY, last].find((wd) => wd >= d)
  const target = day === undefined
    ? new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, MID_MONTH_DAY))
    : new Date(Date.UTC(y, m - 1, day))
  return target.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
}
