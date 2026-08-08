import { Link } from 'react-router-dom'
import { Ban, Clock, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui'

export function PendingScreen() {
  return (
    <div className="max-w-sm text-center space-y-5">
      <div className="h-16 w-16 rounded-full bg-warning/10 border border-warning/25 flex items-center justify-center mx-auto">
        <Clock className="h-8 w-8 text-warning" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-ink mb-2">Candidatura em análise</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          Seu formulário foi enviado e está aguardando a validação dos administradores.
          O acesso à plataforma será liberado após a aprovação da sua candidatura.
        </p>
      </div>
      <p className="text-xs text-ink-muted">
        Dúvidas? Fale conosco no Discord:{' '}
        <a href="https://discord.gg/aRPXe9pnwP" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
          discord.gg/aRPXe9pnwP
        </a>
      </p>
    </div>
  )
}

export function RejectedScreen() {
  return (
    <div className="max-w-sm text-center space-y-5">
      <div className="h-16 w-16 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center mx-auto">
        <span className="text-2xl font-black text-danger">×</span>
      </div>
      <div>
        <h2 className="text-xl font-bold text-ink mb-2">Candidatura não aprovada</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          Infelizmente sua candidatura não foi aprovada desta vez. Entre em contato
          com o suporte para mais informações ou para recorrer da decisão.
        </p>
      </div>
      <a
        href="https://discord.gg/aRPXe9pnwP"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-brand font-semibold hover:underline"
      >
        Contatar suporte
      </a>
    </div>
  )
}

function hoursRemaining(suspendedUntil: string): number {
  const ms = new Date(suspendedUntil).getTime() - Date.now()
  return Math.max(1, Math.ceil(ms / (60 * 60 * 1000)))
}

export function SuspendedScreen({ suspendedUntil }: { suspendedUntil: string | null }) {
  return (
    <div className="max-w-sm text-center space-y-5">
      <div className="h-16 w-16 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center mx-auto">
        <Ban className="h-8 w-8 text-danger" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-ink mb-2">Conta suspensa</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          {suspendedUntil
            ? `Você está suspenso por mais ${hoursRemaining(suspendedUntil)} hora(s). O acesso volta a funcionar automaticamente depois desse período.`
            : 'Sua conta de booster foi suspensa por um administrador e o acesso ao painel está bloqueado enquanto isso.'}
        </p>
      </div>
      <p className="text-xs text-ink-muted">
        Abra um ticket no nosso Discord pra entender o motivo ou contestar a suspensão:{' '}
        <a href="https://discord.gg/aRPXe9pnwP" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
          discord.gg/aRPXe9pnwP
        </a>
      </p>
    </div>
  )
}

export function RemovedScreen() {
  return (
    <div className="max-w-sm text-center space-y-5">
      <div className="h-16 w-16 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center mx-auto">
        <Ban className="h-8 w-8 text-danger" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-ink mb-2">Conta removida</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          Sua conta de booster foi removida permanentemente da plataforma e o acesso não pode ser restaurado por aqui.
        </p>
      </div>
      <p className="text-xs text-ink-muted">
        Dúvidas? Fale com o suporte no Discord:{' '}
        <a href="https://discord.gg/aRPXe9pnwP" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
          discord.gg/aRPXe9pnwP
        </a>
      </p>
    </div>
  )
}

export function NoApplicationScreen() {
  return (
    <div className="max-w-sm text-center space-y-5">
      <div className="h-16 w-16 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center mx-auto">
        <X className="h-8 w-8 text-danger" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-ink mb-2">Candidatura não encontrada</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          Não encontramos uma candidatura de booster vinculada à sua conta.
        </p>
      </div>
      <Button asChild size="sm">
        <Link to="/apply?booster=1">Preencher formulário</Link>
      </Button>
    </div>
  )
}

export function BoosterStatusErrorScreen() {
  return (
    <div className="max-w-sm text-center space-y-5">
      <div className="h-16 w-16 rounded-full bg-danger/10 border border-danger/25 flex items-center justify-center mx-auto">
        <AlertTriangle className="h-8 w-8 text-danger" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-ink mb-2">Não foi possível confirmar seu status</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          Ocorreu um erro ao verificar sua candidatura de booster. Tente novamente em instantes.
        </p>
      </div>
      <Button size="sm" onClick={() => window.location.reload()}>Tentar novamente</Button>
    </div>
  )
}
