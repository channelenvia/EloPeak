import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Zap, Mail } from 'lucide-react'
import { Button, Input, FormField } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useState } from 'react'

const schema = z.object({ email: z.string().email('Digite um e-mail válido') })
type FormData = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSent(true)
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-base px-4">
        <div className="w-full max-w-sm text-center card p-8 space-y-4">
          <div className="h-14 w-14 rounded-2xl bg-success/10 flex items-center justify-center mx-auto">
            <Mail className="h-7 w-7 text-success" />
          </div>
          <h2 className="text-xl font-bold text-ink">Verifique sua caixa de entrada</h2>
          <p className="text-sm text-ink-secondary">Enviamos um link de redefinição de senha para o seu e-mail.</p>
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login">Voltar para o login</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="h-9 w-9 rounded-xl bg-gradient-brand flex items-center justify-center shadow-brand">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-ink">Elo<span className="text-brand">Peak</span></span>
        </Link>

        <div className="card p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-ink">Redefinir senha</h1>
            <p className="text-sm text-ink-secondary mt-1">Enviaremos um link de redefinição por e-mail.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <FormField label="E-mail" error={errors.email?.message} required>
              <Input
                type="email"
                placeholder="voce@exemplo.com"
                leftElement={<Mail className="h-4 w-4" />}
                error={!!errors.email}
                {...register('email')}
              />
            </FormField>
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Enviar Link de Redefinição
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-ink-secondary mt-4">
          <Link to="/login" className="text-brand font-medium hover:underline">← Voltar para o login</Link>
        </p>
      </div>
    </div>
  )
}
