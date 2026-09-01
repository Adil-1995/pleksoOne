import { supabase } from './supabase'
import { nombreSeguro } from './media'
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
  if (/texto_no_vacio|contenido_no_vacio/i.test(mensaje)) {
    return 'Una respuesta tiene que llevar texto, una imagen, o las dos cosas.'
  }
  // PGRST204 = la columna no existe en el esquema que ve PostgREST. Aquí solo
  // puede pasar por una razón, y decirla ahorra media hora de búsqueda.
  if (/imagen_path|imagen_nombre|imagen_tamano|PGRST204/i.test(mensaje)) {
    return 'Falta ejecutar 13-respuestas-con-imagen.sql en el SQL Editor de ' +
           'Supabase: la tabla todavía no tiene las columnas de imagen.'
  }
  return mensaje
}

/**
 * El bucket donde viven las imágenes de las respuestas.
 *
 * Es el MISMO que usa el compositor para lo que se envía, y es público a
 * propósito: cuando se manda la imagen a un cliente, n8n le pasa a Meta una
 * URL y son los servidores de Meta los que la descargan. Una URL firmada
 * caduca y un bucket privado le devolvería un 403.
 */
const BUCKET = 'media'
const CARPETA = 'respuestas'

export async function leerRespuestas(): Promise<RespuestaRapida[]> {
  const { data, error } = await supabase
    .from('respuestas_rapidas').select('*').order('orden').order('id')
  if (error) {
    if (esTablaAusente(error)) return []
    throw new Error(error.message)
  }
  return data ?? []
}

/** Datos de la imagen de una respuesta. `null` en `imagen_path` = quitarla. */
export interface ImagenRespuesta {
  imagen_path: string | null
  imagen_nombre: string | null
  imagen_tamano: number | null
}

export async function crearRespuesta(
  atajo: string, texto: string, imagen?: ImagenRespuesta | null,
): Promise<RespuestaRapida> {
  const limpio = normalizarAtajo(atajo)
  const { data, error } = await supabase
    .from('respuestas_rapidas')
    // `creado_por` NO se manda: lo pone el trigger desde auth.uid(). Si lo
    // mandara el navegador, cualquiera podría decir que la escribió otro.
    //
    // Los campos de imagen SOLO viajan si hay imagen. Mandarlos siempre, aunque
    // fuera con null, haría que crear una respuesta de texto fallase con un
    // PGRST204 en las instalaciones donde todavía no se ha ejecutado
    // 13-respuestas-con-imagen.sql — y eso hoy funciona.
    .insert({ atajo: limpio, texto, orden: 100, ...(imagen ?? {}) })
    .select().single()
  if (error) throw new Error(traducirError(error.message, limpio))
  return data as RespuestaRapida
}

export async function editarRespuesta(
  id: number,
  cambios: { atajo?: string; texto?: string; orden?: number } & Partial<ImagenRespuesta>,
): Promise<void> {
  const limpio = { ...cambios }
  if (limpio.atajo !== undefined) limpio.atajo = normalizarAtajo(limpio.atajo)
  const { error } = await supabase.from('respuestas_rapidas').update(limpio).eq('id', id)
  if (error) throw new Error(traducirError(error.message, cambios.atajo ?? ''))
}

export async function borrarRespuesta(id: number, imagenPath?: string | null): Promise<void> {
  const { error } = await supabase.from('respuestas_rapidas').delete().eq('id', id)
  if (error) throw new Error(error.message)
  // La fila ya no está: el fichero se limpia después y sin bloquear. Si
  // fallase, lo peor que pasa es un huérfano en el bucket que no ve nadie;
  // que eso impidiese borrar la respuesta sería mucho peor.
  if (imagenPath) await borrarImagenRespuesta(imagenPath)
}

/**
 * Sube la imagen de una respuesta y devuelve lo que hay que guardar en la fila.
 *
 * El sello de tiempo delante del nombre evita colisiones entre dos personas
 * subiendo «ficha.jpg» a la vez, igual que en `subirMedia`.
 */
export async function subirImagenRespuesta(file: File): Promise<ImagenRespuesta> {
  const path = `${CARPETA}/${Date.now()}-${nombreSeguro(file.name)}`
  const { error } = await supabase.storage
    .from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return { imagen_path: path, imagen_nombre: file.name, imagen_tamano: file.size }
}

/** Best-effort: un huérfano en el bucket no puede tumbar una edición. */
export async function borrarImagenRespuesta(path: string): Promise<void> {
  try { await supabase.storage.from(BUCKET).remove([path]) } catch { /* da igual */ }
}

/**
 * El fichero de una respuesta, listo para meterlo en el compositor.
 *
 * Se baja de verdad y se envuelve en un `File` en vez de pasarle al envío la
 * URL que ya está en el Storage. Cuesta una descarga, y compensa: así la
 * imagen entra por el MISMO camino que el clip y que Ctrl+V —previsualización,
 * aviso de tamaño, compresión, poder quitarla con la X— en lugar de ser un
 * cuarto camino con sus propios fallos. Y el mensaje que se envía queda con su
 * copia en `salientes/`, así que borrar la respuesta rápida años después no
 * deja huecos en hilos ya enviados.
 */
export async function ficheroDeRespuesta(r: RespuestaRapida): Promise<File | null> {
  if (!r.imagen_path) return null
  const url = urlImagenRespuesta(r.imagen_path)
  if (!url) return null
  const respuesta = await fetch(url)
  if (!respuesta.ok) throw new Error(`No se pudo leer la imagen (${respuesta.status})`)
  const blob = await respuesta.blob()
  return new File([blob], r.imagen_nombre || 'imagen.jpg', {
    type: blob.type || 'image/jpeg',
  })
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

/**
 * URL pública de la imagen de una respuesta, o null si no tiene.
 *
 * Se calcula en el momento y no se guarda: la fila lleva la RUTA, que
 * sobrevive a un cambio de proyecto o de dominio. Ver el punto 1 de
 * 13-respuestas-con-imagen.sql.
 */
export function urlImagenRespuesta(path: string | null | undefined): string | null {
  if (!path) return null
  // Lo que YA es una URL se usa tal cual, igual que hace `useUrlFirmada`.
  // La columna la puede rellenar alguien a mano desde el SQL Editor, y
  // pegar la URL entera es lo que hace cualquiera que no haya leído el
  // comentario del DDL. Pasándola por getPublicUrl saldría una URL
  // imposible —el dominio metido dentro de otra ruta— y la imagen
  // aparecería rota sin explicar por qué.
  if (/^(https?:|data:|blob:)/.test(path)) return path
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

function sinTildes(t: string): string {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
