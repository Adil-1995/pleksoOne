import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * BUSCAR DENTRO DE TODOS LOS MENSAJES, no solo en lo que hay cargado.
 *
 * El buscador de la lista mira el nombre, el número y el ÚLTIMO texto de las
 * conversaciones que estén cargadas. Eso deja fuera dos cosas a la vez: los
 * mensajes que no son el último, y las conversaciones que no entraron en la
 * ventana. Buscar «Chiapas» no encontraba nada aunque un cliente lo hubiera
 * escrito, porque era su penúltimo mensaje.
 *
 * Esto pregunta al SERVIDOR, así que alcanza los 16 000 mensajes.
 *
 * DECISIONES, y lo que cuestan:
 *
 *   · `ilike` con comodines a los dos lados. Es una búsqueda por subcadena,
 *     no por palabras: encuentra «Chiapas» dentro de «deChiapas». SIN ÍNDICE
 *     de momento, así que Postgres recorre la tabla entera. Con 16 000 filas
 *     no se nota; el día que se note, un índice `gin` con `pg_trgm` sobre
 *     `texto` lo arregla sin tocar esta consulta.
 *
 *   · LIMIT 50. No es solo por peso: 50 resultados ya no se leen, se filtran
 *     otra vez. Si hay más, se dice — un tope que no se anuncia hace creer
 *     que no hay nada más.
 *
 *   · CUATRO COLUMNAS y ninguna más. `payload` es el webhook entero de Meta
 *     y multiplicaría por diez el peso de cada resultado.
 *
 *   · MÍNIMO 3 CARACTERES. Con uno o dos, el `ilike` casa con media base y
 *     te devuelve 50 resultados que no significan nada.
 */
export interface MensajeEncontrado {
  id: number
  cliente_id: string
  texto: string | null
  creado: string
}

export const MINIMO_BUSQUEDA = 3
export const TOPE_RESULTADOS = 50

/**
 * Espera a que dejes de escribir antes de preguntar.
 *
 * 300 ms. Sin esto, «Chiapas» son siete consultas y seis se tiran. Y como
 * cada una recorre la tabla sin índice, escribir rápido las encadena.
 */
export function useRetardado<T>(valor: T, ms = 300): T {
  const [tardio, setTardio] = useState(valor)
  useEffect(() => {
    const t = window.setTimeout(() => setTardio(valor), ms)
    return () => window.clearTimeout(t)
  }, [valor, ms])
  return tardio
}

/** Lo que hay que escapar para que un `%` escrito no sea un comodín. */
function paraIlike(t: string): string {
  return t.replace(/[\\%_]/g, (c) => '\\' + c)
}

export function useBuscarMensajes(termino: string) {
  const q = useRetardado(termino.trim(), 300)
  const vale = q.length >= MINIMO_BUSQUEDA

  return useQuery({
    queryKey: ['buscar-mensajes', q],
    enabled: vale,
    // Lo que se acaba de buscar se guarda un rato: volver atrás y repetir la
    // misma búsqueda no puede costar otro recorrido de la tabla.
    staleTime: 60_000,
    queryFn: async (): Promise<MensajeEncontrado[]> => {
      const { data, error } = await supabase
        .from('mensajes')
        .select('id,cliente_id,texto,creado')
        .ilike('texto', '%' + paraIlike(q) + '%')
        .order('creado', { ascending: false })
        .limit(TOPE_RESULTADOS)
      if (error) throw new Error(error.message)
      return (data ?? []) as MensajeEncontrado[]
    },
  })
}

/**
 * Los resultados AGRUPADOS POR CONVERSACIÓN, como WhatsApp.
 *
 * Cincuenta mensajes sueltos de doce clientes no se leen. Agrupados son doce
 * conversaciones con lo que dijeron dentro, y eso sí se lee. Se conserva el
 * orden por fecha: la conversación con el mensaje más nuevo va primera.
 */
export function agrupar(mensajes: MensajeEncontrado[]) {
  const grupos = new Map<string, MensajeEncontrado[]>()
  for (const m of mensajes) {
    const g = grupos.get(m.cliente_id)
    if (g) g.push(m)
    else grupos.set(m.cliente_id, [m])
  }
  return [...grupos.entries()].map(([clienteId, suyos]) => ({ clienteId, mensajes: suyos }))
}
