import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { aplicar, escucharSistema, guardarTema, temaDelPerfil, type Tema } from '@/lib/tema'

/**
 * El tema vivo de la app.
 *
 * Se pinta ANTES de guardar, para que el interruptor no tenga latencia, y si
 * Supabase falla se revierte y se devuelve el error. Mismo criterio que el
 * botón de pausa: la interfaz responde ya, la verdad llega después.
 */
export function useTema() {
  const [tema, setTema] = useState<Tema>('sistema')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Al arrancar y en cada cambio de sesión, el tema sale del perfil.
  useEffect(() => {
    let vivo = true
    supabase.auth.getUser().then(({ data }) => {
      if (!vivo) return
      const t = temaDelPerfil(data.user?.user_metadata)
      setTema(t)
      aplicar(t)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      const t = temaDelPerfil(s?.user?.user_metadata)
      setTema(t)
      aplicar(t)
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [])

  // Con "sistema" elegido, seguir al móvil cuando cambie solo (de noche, etc).
  useEffect(() => {
    if (tema !== 'sistema') return
    return escucharSistema(() => aplicar('sistema'))
  }, [tema])

  const cambiar = useCallback(async (nuevo: Tema) => {
    const anterior = tema
    setTema(nuevo)
    aplicar(nuevo)
    setGuardando(true)
    setError(null)
    try {
      await guardarTema(nuevo)
    } catch (e) {
      // Se deshace: si no se guardó, mentir diciendo que sí garantiza que a
      // la próxima recarga el tema "cambie solo" sin explicación.
      setTema(anterior)
      aplicar(anterior)
      setError(e instanceof Error ? e.message : 'No se pudo guardar el tema')
    } finally {
      setGuardando(false)
    }
  }, [tema])

  return { tema, cambiar, guardando, error }
}
