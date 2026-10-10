import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const CHART_INK_MUTED = 'rgb(var(--color-ink-muted))'
const CHART_INK = 'rgb(var(--color-ink))'
const CHART_SURFACE = 'rgb(var(--color-bg-surface))'
const CHART_BORDER = 'rgb(var(--color-border-subtle))'
const CHART_BRAND = 'rgb(var(--color-brand))'

export interface WeeklyOrdersPoint {
  day: string
  orders: number
}

// Isolado num arquivo proprio para o recharts (grande) so ser baixado quando o grafico aparece (React.lazy no Overview).
export default function WeeklyOrdersChart({ data }: { data: WeeklyOrdersPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_INK_MUTED }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_INK_MUTED }} />
        <Tooltip
          contentStyle={{ background: CHART_SURFACE, border: `1px solid ${CHART_BORDER}`, borderRadius: '0.75rem' }}
          labelStyle={{ color: CHART_INK, fontSize: 12 }}
        />
        <Bar dataKey="orders" fill={CHART_BRAND} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
