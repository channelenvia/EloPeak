import { Link } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { BoosterProfessionalProfileForm } from '@/features/booster/components/BoosterProfessionalProfileForm'
import { BoosterServicesList } from '@/features/booster/components/BoosterServicesList'
import { useOwnBoosterDisplayName } from '@/api/boosters'

export function BoosterServicesPage() {
  const { profile } = useAuthStore()

  // A rota pública usa display_name (não o id) — busca só para o link de preview.
  const { data: boosterDisplayName } = useOwnBoosterDisplayName(profile?.id)

  if (!profile) return null

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Serviços</h1>
          <p className="text-sm text-ink-secondary mt-1">Configure seu perfil profissional e os serviços de coach que você oferece aos clientes.</p>
        </div>
        {boosterDisplayName && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/boosters/${encodeURIComponent(boosterDisplayName)}`} target="_blank" rel="noopener noreferrer">
              <Eye className="h-4 w-4" />
              Visualizar como cliente
            </Link>
          </Button>
        )}
      </div>

      <BoosterProfessionalProfileForm userId={profile.id} />
      <BoosterServicesList userId={profile.id} />
    </div>
  )
}
