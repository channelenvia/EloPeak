import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useForm, Controller, type FieldErrors } from 'react-hook-form'
import { Shield, Clock, DollarSign, Zap, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn, RANK_TIER_ORDER, RANK_TIER_LABEL } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import type { RankTier } from '@/types'
import { supabase } from '@/lib/supabase'

const ROLES = [
  { id: 'top',     label: 'Top'     },
  { id: 'jungle',  label: 'Jungle'  },
  { id: 'mid',     label: 'Mid'     },
  { id: 'adc',     label: 'ADC'     },
  { id: 'support', label: 'Support' },
  { id: 'fill',    label: 'Fill'    },
]

const DAYS = [
  { id: 'Segunda', label: 'Seg' },
  { id: 'Terça',   label: 'Ter' },
  { id: 'Quarta',  label: 'Qua' },
  { id: 'Quinta',  label: 'Qui' },
  { id: 'Sexta',   label: 'Sex' },
  { id: 'Sábado',  label: 'Sáb' },
  { id: 'Domingo', label: 'Dom' },
]

type FormData = {
  summoner_name: string
  opgg_link: string
  peak_tier: RankTier | ''
  roles: string[]
  has_coaching: boolean
  available_days: string[]
  hours_per_day_min: string
  hours_per_day_max: string
  years_experience: string
  motivation: string
  discord_tag: string
  agreed_terms: boolean
}

type Step = 'form' | 'success'

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-semibold text-ink mb-1.5">
      {children}{required && <span className="text-danger ml-0.5">*</span>}
    </label>
  )
}

function CheckPill({
  checked, onChange, label,
}: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'px-3 py-2 rounded-xl text-sm font-medium border transition-all',
        checked
          ? 'bg-brand/15 border-brand text-brand'
          : 'border-bg-elevated text-ink-muted hover:border-bg-overlay hover:text-ink-secondary'
      )}
    >
      {checked && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />}
      {label}
    </button>
  )
}

export function BoosterApplyPage() {
  const { profile } = useAuthStore()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('form')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register, handleSubmit, control, watch,
    formState: { errors },
  } = useForm<FormData>({
    mode: 'onChange',
    defaultValues: {
      summoner_name: '',
      opgg_link: '',
      peak_tier: '',
      roles: [],
      has_coaching: false,
      available_days: [],
      hours_per_day_min: '',
      hours_per_day_max: '',
      years_experience: '',
      motivation: '',
      discord_tag: '',
      agreed_terms: false,
    },
  })

  async function onSubmit(data: FormData) {
    setError(null)
    setSubmitting(true)
    try {
      const minH = Number(data.hours_per_day_min) || 0
      const maxH = Number(data.hours_per_day_max) || minH
      const hoursPerWeek = Math.round(((minH + maxH) / 2) * (data.available_days.length || 5))

      const payload = {
        summoner_name: data.summoner_name,
        opgg_link: data.opgg_link || null,
        region: 'BR',
        peak_rank: data.peak_tier,
        roles: data.roles,
        games: ['lol'],
        hours_per_week: hoursPerWeek,
        available_days: data.available_days,
        years_experience: Number(data.years_experience),
        motivation: data.motivation,
        discord_tag: data.discord_tag || null,
        has_coaching: data.has_coaching,
        user_id: profile?.id ?? null,
        status: 'pending' as const,
      }

      const { error: dbErr } = await supabase
        .from('booster_applications')
        .insert(payload)

      if (dbErr) {
        setError(`Erro: ${dbErr.message} (code: ${dbErr.code})`)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      setStep('success')
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message
      setError(msg || 'Algo deu errado. Tente novamente.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  function onInvalid(errs: FieldErrors<FormData>) {
    const labels: Record<string, string> = {
      summoner_name:    'Nome do Invocador',
      peak_tier:        'Rank de Pico',
      roles:            'Funções preferidas',
      available_days:   'Dias disponíveis',
      hours_per_day_max:'Horas por dia',
      years_experience: 'Anos de experiência',
      motivation:       'Motivação (mín. 80 chars)',
      agreed_terms:     'Aceitar os termos',
    }
    const missing = Object.keys(errs).map(k => labels[k] ?? k).join(', ')
    setError(`Preencha os campos obrigatórios: ${missing}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (step === 'success') {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-5">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center space-y-6"
        >
          <div className="h-20 w-20 rounded-full bg-success/15 border border-success/30 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-10 w-10 text-success" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-ink mb-3">Candidatura recebida!</h1>
            <p className="text-ink-secondary leading-relaxed">
              Revisamos cada candidatura manualmente. Esperamos responder via Discord ou e-mail
              em até <strong className="text-ink">2–5 dias úteis</strong>. Entraremos em contato
              com os próximos passos se você for aprovado.
            </p>
          </div>
          <div className="card p-5 text-left space-y-2 text-sm text-ink-secondary">
            <p className="font-semibold text-ink text-base mb-3">O que acontece a seguir</p>
            {[
              'Revisão manual do seu OP.GG e dados da candidatura',
              'Entrevista curta de onboarding (Discord)',
              'Observação de partida teste com um booster sênior',
              'Configuração de conta e pagamentos',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="h-5 w-5 rounded-full bg-brand/15 text-brand text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <Button size="lg" className="w-full" onClick={() => navigate('/dashboard')}>
            Ir para o painel
          </Button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="bg-bg-base">
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] w-full max-w-xl px-4">
          <div className="bg-danger text-white rounded-xl px-5 py-4 text-sm font-medium shadow-lg flex items-start justify-between gap-3">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100 text-lg leading-none">×</button>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="relative bg-bg-surface border-b border-bg-elevated overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-50 pointer-events-none" />
        <div className="max-w-screen-xl mx-auto px-5 sm:px-8 py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
            >
              <p className="section-label mb-4">Junte-se à nossa equipe</p>
              <h1 className="text-4xl md:text-5xl font-black text-ink mb-5 leading-tight">
                Candidate-se como<br /><span className="text-gradient-brand">Booster Profissional</span>
              </h1>
              <p className="text-ink-secondary text-lg leading-relaxed mb-8">
                Jogadores Grão-mestre ou acima ganham R$15–R$80 por pedido, definem seus próprios
                horários e trabalham na plataforma de boosting mais confiável da região.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: DollarSign, title: 'R$15–R$80 por pedido', sub: 'Pago semanalmente via PayPal/Wise' },
                  { icon: Clock,      title: 'Horários flexíveis',    sub: 'Escolha os dias que trabalha'      },
                  { icon: Shield,     title: 'Sessões protegidas',    sub: 'VPN + credenciais criptografadas'  },
                  { icon: Zap,        title: 'Onboarding rápido',     sub: '2–5 dias após a candidatura'       },
                ].map(({ icon: Icon, title, sub }) => (
                  <div key={title} className="flex gap-3">
                    <div className="h-10 w-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-brand" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">{title}</p>
                      <p className="text-xs text-ink-muted mt-0.5">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <div className="hidden lg:flex items-center justify-center">
              <div className="card p-6 w-full max-w-xs space-y-4">
                <p className="section-label">Requisitos</p>
                {[
                  'Grão-mestre ou acima (temporada atual)',
                  'Pelo menos uma função dominada',
                  '10+ horas/semana de disponibilidade',
                  'Comunicação empática com o cliente em português',
                  'Perfil OP.GG verificável',
                ].map(req => (
                  <div key={req} className="flex items-start gap-2 text-sm text-ink-secondary">
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    <span>{req}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-16">
        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-10">

          {/* Section 1: Account info */}
          <div>
            <h2 className="text-xl font-bold text-ink mb-6 pb-3 border-b border-bg-elevated">
              Informações da Conta
            </h2>
            <div className="space-y-5">
              <div>
                <FieldLabel required>Nome do Invocador</FieldLabel>
                <input
                  {...register('summoner_name', { required: 'Obrigatório' })}
                  placeholder="SeuNomeDeInvocador"
                  className="input-base w-full"
                />
                {errors.summoner_name && <p className="text-danger text-xs mt-1">{errors.summoner_name.message}</p>}
              </div>

              <div>
                <FieldLabel>Link do OP.GG</FieldLabel>
                <input
                  {...register('opgg_link', {
                    pattern: { value: /^https?:\/\//i, message: 'Digite uma URL válida' },
                  })}
                  placeholder="https://op.gg/summoners/br/SeuNome"
                  className="input-base w-full"
                />
                {errors.opgg_link && <p className="text-danger text-xs mt-1">{errors.opgg_link.message}</p>}
              </div>

              <div>
                <FieldLabel required>Rank de Pico (temporada atual)</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Controller
                    name="peak_tier"
                    control={control}
                    rules={{ required: 'Selecione seu rank de pico' }}
                    render={({ field }) => (
                      <>
                        {RANK_TIER_ORDER.map(tier => (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => field.onChange(tier)}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                              field.value === tier
                                ? 'border-brand bg-brand/15 text-brand'
                                : 'border-bg-elevated text-ink-muted hover:border-bg-overlay'
                            )}
                          >
                            {RANK_TIER_LABEL[tier]}
                          </button>
                        ))}
                      </>
                    )}
                  />
                </div>
                {errors.peak_tier && <p className="text-danger text-xs mt-1">{errors.peak_tier.message}</p>}
              </div>
            </div>
          </div>

          {/* Section 2: Play style */}
          <div>
            <h2 className="text-xl font-bold text-ink mb-6 pb-3 border-b border-bg-elevated">
              Estilo de Jogo
            </h2>
            <div className="space-y-5">
              <div>
                <FieldLabel required>Funções preferidas</FieldLabel>
                <p className="text-xs text-ink-muted mb-2">Selecione todas as lanes que você domina.</p>
                <Controller
                  name="roles"
                  control={control}
                  rules={{ validate: v => v.length > 0 || 'Selecione pelo menos uma função' }}
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-2">
                      {ROLES.map(role => (
                        <CheckPill
                          key={role.id}
                          label={role.label}
                          checked={field.value.includes(role.id)}
                          onChange={() => {
                            const next = field.value.includes(role.id)
                              ? field.value.filter(r => r !== role.id)
                              : [...field.value, role.id]
                            field.onChange(next)
                          }}
                        />
                      ))}
                    </div>
                  )}
                />
                {errors.roles && <p className="text-danger text-xs mt-1">{errors.roles.message}</p>}
              </div>

              <div>
                <FieldLabel required>Capacidade de coaching</FieldLabel>
                <p className="text-xs text-ink-muted mb-2">Boosters com coaching ganham pedidos extras e taxas maiores.</p>
                <Controller
                  name="has_coaching"
                  control={control}
                  render={({ field }) => (
                    <div className="flex gap-3">
                      {[
                        { v: true,  label: 'Sim, posso fazer coaching' },
                        { v: false, label: 'Apenas boosting'           },
                      ].map(({ v, label }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => field.onChange(v)}
                          className={cn(
                            'px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                            field.value === v
                              ? 'border-brand bg-brand/15 text-brand'
                              : 'border-bg-elevated text-ink-muted hover:border-bg-overlay'
                          )}
                        >
                          {field.value === v && <CheckCircle2 className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />}
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Availability */}
          <div>
            <h2 className="text-xl font-bold text-ink mb-6 pb-3 border-b border-bg-elevated">
              Disponibilidade
            </h2>
            <div className="space-y-5">
              <div>
                <FieldLabel required>Dias disponíveis</FieldLabel>
                <Controller
                  name="available_days"
                  control={control}
                  rules={{ validate: v => v.length > 0 || 'Selecione pelo menos um dia' }}
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map(({ id, label }) => (
                        <CheckPill
                          key={id}
                          label={label}
                          checked={field.value.includes(id)}
                          onChange={() => {
                            const next = field.value.includes(id)
                              ? field.value.filter(d => d !== id)
                              : [...field.value, id]
                            field.onChange(next)
                          }}
                        />
                      ))}
                    </div>
                  )}
                />
                {errors.available_days && <p className="text-danger text-xs mt-1">{errors.available_days.message}</p>}
              </div>

              <div>
                <FieldLabel required>Horas disponíveis por dia</FieldLabel>
                <p className="text-xs text-ink-muted mb-2">Informe o intervalo típico nos dias que você joga.</p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <p className="text-xs text-ink-muted mb-1">Mínimo</p>
                    <input
                      {...register('hours_per_day_min', {
                        required: 'Obrigatório',
                        min: { value: 1, message: 'Mínimo 1h' },
                        max: { value: 24, message: 'Máximo 24h' },
                      })}
                      type="number"
                      min={1}
                      max={24}
                      placeholder="2"
                      className="input-base w-24"
                    />
                  </div>
                  <span className="text-ink-muted pb-2">–</span>
                  <div>
                    <p className="text-xs text-ink-muted mb-1">Máximo</p>
                    <input
                      {...register('hours_per_day_max', {
                        required: 'Obrigatório',
                        min: { value: 1, message: 'Mínimo 1h' },
                        max: { value: 24, message: 'Máximo 24h' },
                      })}
                      type="number"
                      min={1}
                      max={24}
                      placeholder="8"
                      className="input-base w-24"
                    />
                  </div>
                  <span className="text-sm text-ink-muted pb-2">horas/dia</span>
                </div>
                {(errors.hours_per_day_min || errors.hours_per_day_max) && (
                  <p className="text-danger text-xs mt-1">
                    {errors.hours_per_day_min?.message || errors.hours_per_day_max?.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Section 4: About you */}
          <div>
            <h2 className="text-xl font-bold text-ink mb-6 pb-3 border-b border-bg-elevated">
              Sobre Você
            </h2>
            <div className="space-y-5">
              <div>
                <FieldLabel required>Anos de experiência em boosting / competitivo</FieldLabel>
                <input
                  {...register('years_experience', {
                    required: 'Obrigatório',
                    min: { value: 0, message: 'Deve ser 0 ou mais' },
                  })}
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="ex: 2"
                  className="input-base w-40"
                />
                {errors.years_experience && <p className="text-danger text-xs mt-1">{errors.years_experience.message}</p>}
              </div>

              <div>
                <FieldLabel>Discord Tag (opcional, mas recomendado)</FieldLabel>
                <input
                  {...register('discord_tag')}
                  placeholder="username#0000"
                  className="input-base w-full"
                />
              </div>

              <div>
                <FieldLabel required>
                  Por que você quer entrar na nossa equipe? O que te destaca?
                </FieldLabel>
                <p className="text-xs text-ink-muted mb-2">
                  Conte sobre sua pool de campeões, histórico ranqueado e o que te torna confiável.
                  Mínimo de 80 caracteres.
                </p>
                <textarea
                  {...register('motivation', {
                    required: 'Obrigatório',
                    minLength: { value: 80, message: 'Mínimo de 80 caracteres' },
                  })}
                  rows={5}
                  placeholder="Jogo no Grão-mestre há 2 temporadas. Minha pool principal é Zed/Fizz/Akali mid. Sou conhecido por comunicação clara e atendimento ao cliente…"
                  className="input-base w-full resize-none"
                />
                <div className="flex justify-between mt-1">
                  {errors.motivation
                    ? <p className="text-danger text-xs">{errors.motivation.message}</p>
                    : <span />
                  }
                  <p className="text-xs text-ink-muted">{watch('motivation')?.length ?? 0} caracteres</p>
                </div>
              </div>
            </div>
          </div>

          {/* Terms */}
          <div className="card p-5">
            <label className="flex items-start gap-3 cursor-pointer">
              <Controller
                name="agreed_terms"
                control={control}
                rules={{ validate: v => v || 'Você deve aceitar os termos' }}
                render={({ field }) => (
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={e => field.onChange(e.target.checked)}
                    className="h-4 w-4 mt-0.5 accent-brand"
                  />
                )}
              />
              <span className="text-sm text-ink-secondary leading-relaxed">
                Confirmo que sou dono da(s) conta(s) que usarei para demonstração, tenho pelo menos
                18 anos e concordo com os{' '}
                <Link to="/terms" className="text-brand hover:underline">Termos de Serviço</Link>{' '}
                e a{' '}
                <Link to="/privacy" className="text-brand hover:underline">Política de Privacidade</Link>.
              </span>
            </label>
            {errors.agreed_terms && (
              <p className="text-danger text-xs mt-2 ml-7">{errors.agreed_terms.message}</p>
            )}
          </div>

          <Button type="submit" size="lg" loading={submitting} className="w-full">
            Enviar Candidatura
          </Button>
        </form>
      </div>
    </div>
  )
}
