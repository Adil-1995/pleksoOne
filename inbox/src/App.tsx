import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Login } from '@/componentes/Login'
import { Inbox } from '@/paginas/Inbox'
import { PaginaAjustes } from '@/paginas/Ajustes'
import { ErrorBoundary } from '@/componentes/ErrorBoundary'
import { useTema } from '@/hooks/useTema'

// Rutas HASH: dentro de Capacitor no hay servidor que resuelva /c/123,
// así que /#/c/123 es lo único que funciona en las tres plataformas.

const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      // Nada de cachear datos en disco: en Capacitor no queremos
      // enseñar conversaciones viejas como si fueran de ahora.
      gcTime: 5 * 60_000,
    },
  },
})

export default function App() {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [comprobando, setComprobando] = useState(true)

  // Aquí solo para APLICARLO al arrancar, también en la pantalla de login.
  // El interruptor de la cabecera usa el mismo hook; los dos se enteran de los
  // cambios por el evento USER_UPDATED de Supabase, así que no se desincronizan.
  useTema()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setComprobando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (comprobando) {
    return (
      <div className="flex h-full items-center justify-center bg-fondo">
        <div className="esqueleto h-10 w-40 rounded-lg" />
      </div>
    )
  }

  if (!sesion) return <Login />

  return (
    <ErrorBoundary zona="la aplicación">
      <QueryClientProvider client={cliente}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Inbox />} />
          <Route path="/c/:clienteId" element={<Inbox />} />
          <Route path="/ajustes" element={<PaginaAjustes />} />
          {/* Las rutas viejas siguen llevando a algún sitio: había enlaces
              a /etiquetas desde el menú de la conversación. */}
          <Route path="/etiquetas" element={<Navigate to="/ajustes" replace />} />
          <Route path="/canales" element={<Navigate to="/ajustes" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
