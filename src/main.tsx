import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Providers } from './app/providers'
import { router } from './app/router'
import './styles/globals.css'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg-base px-6">
          <div className="max-w-md text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-danger/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-danger" />
            </div>
            <h1 className="text-xl font-bold text-ink">Algo deu errado</h1>
            {import.meta.env.DEV && (
              <pre className="text-xs text-danger bg-danger/10 rounded-xl p-4 text-left overflow-auto max-h-48">
                {(this.state.error as Error).message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-semibold"
            >
              Recarregar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </ErrorBoundary>
  </React.StrictMode>
)
