import { supabase } from './supabase'
import type { RespuestaRapida } from '@/tipos'

/**
 * Respuestas rápidas: los comandos de «/».
 *
 * Viven en Supabase, no en el navegador. El encargo era verlas igual desde el
 * móvil y desde el PC, y en localStorage cada aparato tendría su propia lista
 * sin que nadie se entere de que discrepan.
 *
 * Son del equipo entero (RLS `USING (true)` para `authenticated`, ver
 * 12-respuestas-rapidas.sql). Dos personas atendiendo el mismo WhatsApp tienen
 * que contestar lo mismo.
 */

/** Sin barras ni espacios. Lo mismo que impone el CHECK `atajo_de_una_pieza`. */
export const ATAJO_VALIDO = /^[^\s/]{1,24}$/

/**
 * Lo que hay tras la barra, o null si el desplegable no debe abrirse.
 *
 * Solo al PRINCIPIO del campo y sin espacios, como en WhatsApp Business.
 * Restringirlo así lo hace predecible: nunca aparece a media frase porque
 * hayas escrito una fecha con barras o «y/o».
 */
export function filtroDe(texto: string): string | null {
  const m = texto.match(/^\/(\S*)$/)
  return m ? m[1] : null
}

/**
 * La tabla es de 12-respuestas-rapidas.sql y puede no existir todavía. Sin
 * ella el inbox funciona igual, solo que «/» no ofrece nada — mismo criterio
 * que `leerEtiquetas` con su tabla.
 */
function esTablaAusente(error: { code?: string; message: string }): boolean {
  return error.code === 'PGRST205' || /schema cache/i.test(error.message)
}

function traducirError(mensaje: string, atajo: string): string {
  if (/uq_respuestas_atajo|duplicate key/i.test(mensaje)) {
    return `Ya existe una respuesta con el atajo "/${atajo.trim()}".`
  }
  if (/atajo_de_una_pieza/i.test(mensaje)) {
    return 'El atajo no puede llevar espacios ni barras, y como mucho 24 caracteres.'
  }
  if (/texto_no_vacio/i.test(mensaje)) {
    return 'El texto no puede estar vacío.'
  }
  return mensaje
}

export async function leerRespuestas(): Promise<RespuestaRapida[]> {
  const { data, error } = await supabase
    .from('respuestas_rapidas').select('*').order('orden').order('id')
  if (error) {
    if (esTablaAusente(error)) return []
    throw new Error(error.message)
  }
  return data ?? []
}

export async function crearRespuesta(atajo: string, texto: string): Promise<RespuestaRapida> {
  const limpio = normalizarAtajo(atajo)
  const { data, error } = await supabase
    .from('respuestas_rapidas')
    // `creado_por` NO se manda: lo pone el trigger desde auth.uid(). Si lo
    // mandara el navegador, cualquiera podría decir que la escribió otro.
    .insert({ atajo: limpio, texto, orden: 100 })
    .select().single()
  if (error) throw new Error(traducirError(error.message, limpio))
  return data as RespuestaRapida
}

export async function editarRespuesta(
  id: number, cambios: { atajo?: string; texto?: string; orden?: number },
): Promise<void> {
  const limpio = { ...cambios }
  if (limpio.atajo !== undefined) limpio.atajo = normalizarAtajo(limpio.atajo)
  const { error } = await supabase.from('respuestas_rapidas').update(limpio).eq('id', id)
  if (error) throw new Error(traducirError(error.message, cambios.atajo ?? ''))
}

export async function borrarRespuesta(id: number): Promise<void> {
  const { error } = await supabase.from('respuestas_rapidas').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Quita la barra que la gente escribe por costumbre y los espacios de los
 * lados. Se guarda «envio» aunque teclees «/envio ».
 */
export function normalizarAtajo(atajo: string): string {
  return atajo.trim().replace(/^\/+/, '').trim()
}

/**
 * Filtra por lo escrito tras la barra, sin distinguir mayúsculas ni tildes.
 *
 * Las que EMPIEZAN por lo tecleado van primero: escribiendo «env» interesa
 * más «/envio» que «/reenviar», aunque las dos contengan «env». Dentro de
 * cada grupo se respeta el orden de la lista.
 */
export function filtrarRespuestas(
  respuestas: RespuestaRapida[], filtro: string,
): RespuestaRapida[] {
  const f = sinTildes(filtro)
  if (!f) return respuestas
  const empiezan: RespuestaRapida[] = []
  const contienen: RespuestaRapida[] = []
  for (const r of respuestas) {
    const a = sinTildes(r.atajo)
    if (a.startsWith(f)) empiezan.push(r)
    else if (a.includes(f)) contienen.push(r)
  }
  return [...empiezan, ...contienen]
}

function sinTildes(t: string): string {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
