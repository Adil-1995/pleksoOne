import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * EL ORDEN DE LOS ICONOS DE LA BARRA, por usuario.
 *
 * DÓNDE VIVE: en `user_metadata` de Supabase, igual que el canal por defecto
 * y el tema. No hace falta tabla ni DDL ni RLS:
 *
 *   · está en Supabase, no en el navegador, así que el mismo orden sale en
 *     el móvil y en el PC;
 *   · es POR USUARIO por construcción — cuelga de la fila del usuario en
 *     `auth.users`, no hay forma de que uno vea el orden de otro;
 *   · viaja con la sesión y funciona en Capacitor.
 *
 * Y es lo correcto además por lo que NO es: `user_metadata` lo puede editar
 * el propio usuario, así que no vale para nada de permisos ni de negocio.
 * Para dónde te colocas los iconos es exactamente lo que hace falta.
 *
 * EL ORDEN GUARDADO NO MANDA DEL TODO, y esto importa: se guarda una lista
 * de ids, pero al leerla se CRUZA con los iconos que existen hoy. Los ids
 * que ya no existen se tiran, y los que son nuevos se añaden al final. Si
 * mañana se añade un filtro y alguien tiene un orden guardado de hoy, el
 * filtro nuevo le aparece igual — en vez de desaparecer sin que nadie se
 * entere, que es como se pierden las cosas en silencio.
 */
export function ordenarConGuardado(porDefecto: string[], guardado: string[] | null): string[] {
  if (!guardado || !guardado.length) return porDefecto
  const existen = new Set(porDefecto)
  const puestos = guardado.filter((id) => existen.has(id))
  const yaEstan = new Set(puestos)
  return [...puestos, ...porDefecto.filter((id) => !yaEstan.has(id))]
}

function leer(metadata: Record<string, unknown> | undefined): string[] | null {
  const v = metadata?.orden_barra
  if (!Array.isArray(v)) return null
  const ids = v.filter((x): x is string => typeof x === 'string')
  return ids.length ? ids : null
}

export function useOrdenBarra(porDefecto: string[]) {
  const [guardado, setGuardado] = useState<string[] | null>(null)
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    let vivo = true
    supabase.auth.getUser().then(({ data }) => {
      if (!vivo) return
      setGuardado(leer(data.user?.user_metadata))
      setCargado(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setGuardado(leer(s?.user?.user_metadata))
      setCargado(true)
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [])

  const orden = ordenarConGuardado(porDefecto, guardado)

  /**
   * Se pinta ya y se guarda detrás. Si el guardado falla SE DESHACE: dejar
   * los iconos donde los soltaste y que mañana estén en otro sitio es peor
   * que no haberlos movido, porque nadie sabría por qué.
   */
  const guardar = useCallback(async (nuevo: string[]) => {
    const anterior = guardado
    setGuardado(nuevo)
    const { error } = await supabase.auth.updateUser({ data: { orden_barra: nuevo } })
    if (error) {
      setGuardado(anterior)
      console.error('[barra] no se pudo guardar el orden:', error.message)
    }
  }, [guardado])

  return { orden, guardar, cargado }
}
