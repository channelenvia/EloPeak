import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Zap, Lock } from 'lucide-react'
import { Button, Input, FormField } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useState } from 'react'

const schema = z.object({
  password: z.string().min(8, 'Mínimo de 8 caracteres'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'As senhas não coincidem',
  path: ['confirmPassword'],
})

type FormData = z.infer<typeof schema>

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError(null)
    const { error } = await supabase.auth.updateUser({ password: data.password })
    if (error) { setServerError(error.message); return }
    navigate('/login')
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
            <h1 className="text-xl font-bold text-ink">Definir nova senha</h1>
            <p className="text-sm text-ink-secondary mt-1">Escolha uma senha forte.</p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <FormField label="Nova Senha" error={errors.password?.message} required>
              <Input type="password" placeholder="••••••••" leftElement={<Lock className="h-4 w-4" />} error={!!errors.password} {...register('password')} />
            </FormField>
            <FormField label="Confirmar Senha" error={errors.confirmPassword?.message} required>
              <Input type="password" placeholder="••••••••" leftElement={<Lock className="h-4 w-4" />} error={!!errors.confirmPassword} {...register('confirmPassword')} />
            </FormField>
            {serverError && <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{serverError}</p>}
            <Button type="submit" className="w-full" loading={isSubmitting}>Atualizar Senha</Button>
          </form>
        </div>
      </div>
    </div>
  )
}
