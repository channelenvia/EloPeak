// Um só Intl.NumberFormat de módulo -- não muda entre chamadas (locale/moeda
// são fixos), então não há motivo pra realocar um formatter novo a cada
// chamada do hook nem a cada invocação da função retornada.
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
})

export function useCurrency() {
  return (amount: number) => currencyFormatter.format(amount)
}
