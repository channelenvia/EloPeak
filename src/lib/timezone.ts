// Y/M/D/H of `date` as seen in `timeZone`'s local wall clock. Postgres has
// no `AT TIME ZONE` equivalent in JS beyond Intl -- formatToParts is the
// only reliable cross-runtime (browser + Deno) way to get this without a
// date library. hour12:false can report "24" for local midnight in some
// engines, normalized to 0 here.
export function localDateParts(date: Date, timeZone: string): { y: number; m: number; d: number; h: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false,
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const hour = get('hour')
  return { y: get('year'), m: get('month'), d: get('day'), h: hour === 24 ? 0 : hour }
}
