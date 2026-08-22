import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * El canal que se ve al abrir el inbox.
 *
 * Vive en `user_metadata` de Supabase, igual que el tema: es el perfil del
 * usuario, viaja con la sesión, funciona en Capacitor y se sincroniza entre
 * el móvil y el escritorio. Nada de localStorage.
 *
 * `null` significa "Todos" — y es un valor guardado de verdad, no la
 * ausencia de preferencia: si eliges Todos a propósito, mañana sigues en
 * Todos aunque antes tuvieras México.
 */
export function useCanalPorDefecto() {
  const [canalId, setCanalId] = useState<number | null>(null)
  const [cargado, setCargado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.auth.getUser().then(({ data }) => {
      if (!vivo) return
      setCanalId(leer(data.user?.user_metadata))
      setCargado(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setCanalId(leer(s?.user?.user_metadata))
      setCargado(true)
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [])

  const guardar = useCallback(async (nuevo: number | null) => {
    const anterior = canalId
    setCanalId(nuevo)          // se pinta ya; el guardado va detrás
    setError(null)
    const { error: e } = await supabase.auth.updateUser({ data: { canal_por_defecto: nuevo } })
    if (e) {
      // Se deshace: decir que se guardó cuando no, hace que mañana el inbox
      // "cambie solo" de canal sin explicación.
      setCanalId(anterior)
      setError(e.message)
    }
  }, [canalId])

  return { canalId, guardar, cargado, error }
}

function leer(metadata: Record<string, unknown> | undefined): number | null {
  const v = metadata?.canal_por_defecto
  return typeof v === 'number' ? v : null
}
