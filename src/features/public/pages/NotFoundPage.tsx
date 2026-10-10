import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Button } from '@/components/ui'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <Helmet><meta name="robots" content="noindex" /></Helmet>
      <p className="text-5xl font-bold text-ink">404</p>
      <p className="text-ink-secondary">Não encontramos essa página.</p>
      <Link to="/"><Button variant="primary">Voltar ao início</Button></Link>
    </div>
  )
}
