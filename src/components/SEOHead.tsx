import { Helmet } from 'react-helmet-async'

interface SEOHeadProps {
  title: string
  description: string
}

// Meta por rota para as páginas públicas (marketing + perfil de booster) --
// o restante da app (autenticada) não precisa disso, nunca é indexado/
// compartilhado. title já sai formatado "X | EloPeak", só passar o
// prefixo específico da página.
export function SEOHead({ title, description }: SEOHeadProps) {
  const fullTitle = `${title} | EloPeak`
  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
    </Helmet>
  )
}
