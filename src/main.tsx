import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { App } from './app/App'
import { AuthProvider } from './app/AuthProvider'
import { ConnectScreen } from './features/setup/ConnectScreen'
import { ErrorBoundary } from './app/ErrorBoundary'
import { isConfigured } from './lib/config'
import { resetSupabaseClient } from './lib/supabase'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Server state goes stale after 30s; refetch on focus keeps counter
      // terminals honest without hammering the API.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

/**
 * Nothing may touch the database before we know where it is. AuthProvider
 * queries on mount, so the connection gate has to sit above it — otherwise an
 * unconfigured app throws during render and the user sees a blank page.
 */
// eslint-disable-next-line react-refresh/only-export-components
function Root() {
  const [connected, setConnected] = useState(isConfigured)

  if (!connected) {
    return (
      <ConnectScreen
        onConnected={() => {
          resetSupabaseClient()
          queryClient.clear()
          setConnected(true)
        }}
      />
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <Toaster position="top-center" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outermost, so a render error anywhere shows a recoverable screen
        rather than an unexplained blank page. */}
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
