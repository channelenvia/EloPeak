const CPF_LENGTH = 11

// Espelho de public.is_valid_cpf (banco): a mascara e ignorada, mas so contam digitos ASCII.
export function isValidCpf(value: string): boolean {
  const digits = value.replace(/[.\-\s]/g, '')
  if (!new RegExp(`^[0-9]{${CPF_LENGTH}}$`).test(digits) || /^([0-9])\1+$/.test(digits)) return false
  const nums = [...digits].map(Number)
  for (const k of [9, 10]) {
    const sum = nums.slice(0, k).reduce((acc, n, i) => acc + n * (k + 1 - i), 0)
    if (((sum * 10) % 11) % 10 !== nums[k]) return false
  }
  return true
}
