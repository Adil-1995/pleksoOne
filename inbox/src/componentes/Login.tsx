import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { LogIn, Loader2 } from 'lucide-react'

export function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave })
    setCargando(false)
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : error.message,
      )
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-fondo px-6">
      <form onSubmit={entrar} className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-acento">
            <LogIn className="h-8 w-8 text-fondo" />
          </div>
          <h1 className="text-xl font-semibold">LumaBot Inbox</h1>
          <p className="mt-1 text-sm text-texto2">Lado Luminoso</p>
        </div>

        <label className="mb-1 block text-sm text-texto2" htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-borde bg-panel px-3 py-2.5 outline-none focus:border-acento"
        />

        <label className="mb-1 block text-sm text-texto2" htmlFor="clave">Contraseña</label>
        <input
          id="clave"
          type="password"
          autoComplete="current-password"
          required
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          className="mb-6 w-full rounded-lg border border-borde bg-panel px-3 py-2.5 outline-none focus:border-acento"
        />

        {error && (
          <p className="mb-4 rounded-lg bg-alerta/10 px-3 py-2 text-sm text-alerta">{error}</p>
        )}

        <button
          type="submit"
          disabled={cargando}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-acento py-2.5 font-medium text-fondo disabled:opacity-60"
        >
          {cargando && <Loader2 className="h-4 w-4 animate-spin" />}
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
