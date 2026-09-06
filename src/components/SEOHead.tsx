import { Helmet } from 'react-helmet-async'

interface SEOHeadProps {
  title: string
  description: string
  /** Caminho absoluto pra imagem de compartilhamento (ex.: "/images/logo.png") -- default é a logo do site. */
  image?: string
}

// Mesmo domínio placeholder usado em public/sitemap.xml e no fallback de
// APP_URL das edge functions de Discord -- trocar pelo domínio real de
// produção antes do deploy final.
const SITE_URL = 'https://elo-peak.vercel.app'

// Meta por rota para as páginas públicas (marketing + perfil de booster) --
// o restante da app (autenticada) não precisa disso, nunca é indexado/
// compartilhado. title já sai formatado "X | EloPeak", só passar o
// prefixo específico da página.
export function SEOHead({ title, description, image = '/images/logo.png' }: SEOHeadProps) {
  const fullTitle = `${title} | EloPeak`
  // App é CSR puro (sem SSR) -- window sempre disponível em runtime real;
  // pathname sem query string, prática padrão pra canonical.
  const canonicalUrl = `${SITE_URL}${window.location.pathname}`
  const imageUrl = image.startsWith('http') ? image : `${SITE_URL}${image}`
  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={imageUrl} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </Helmet>
  )
}
