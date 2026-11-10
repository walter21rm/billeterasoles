export function solesToCents(value: string): number | null {
  const cleaned = value.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, fraction = ''] = cleaned.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 2_147_483_647) return null
  return cents
}

export function formatSoles(cents: number): string {
  const negative = cents < 0
  const absolute = Math.abs(cents)
  const whole = Math.floor(absolute / 100)
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${negative ? '-' : ''}S/ ${whole}.${fraction}`
}
