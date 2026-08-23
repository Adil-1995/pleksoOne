import { supabase } from './supabase'
import { avisarPurchase } from './envio'
import type { Etiqueta, EstadoProducto, Canal, MarcaRevision } from '@/tipos'

/**
 * Cambios sobre una conversación que el equipo hace desde el inbox.
 *
 * Todo esto va DIRECTO a Supabase, no por n8n: son UPDATE sobre
 * `conversaciones`, que la policy `equipo_edita_conv` permite. Por n8n solo
 * pasa lo que sale hacia WhatsApp (regla 2) y el bloqueo, que además de
 * escribir aquí tiene que hablar con Meta.
 */

export async function ponerFavorita(clienteId: string, favorita: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversaciones').update({ favorita }).eq('cliente_id', clienteId)
  if (error) throw new Error(error.message)
}

export async function ponerSilenciada(clienteId: string, silenciada: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversaciones').update({ silenciada }).eq('cliente_id', clienteId)
  if (error) throw new Error(error.message)
}

export async function ponerFijada(clienteId: string, fijada: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversaciones').update({ fijada }).eq('cliente_id', clienteId)
  if (error) throw new Error(error.message)
}

// ── Marcar comprado a mano ───────────────────────────────────────────────
/**
 * CORRECCIÓN, no sustitución. El pedido automático sigue escribiendo aquí
 * igual que antes; esto es para arreglar lo que no detectó o detectó mal.
 *
 * `marcado_por` y `marcado_en` NO se mandan desde aquí: los pone un trigger
 * a partir de auth.uid(). Si los mandara el navegador, cualquiera podría
 * decir que la marca la puso otro.
 */
export async function marcarProducto(
  conversacionId: number, producto: string, estado: EstadoProducto,
): Promise<void> {
  const { error } = await supabase
    .from('conversacion_productos')
    .upsert({ conversacion_id: conversacionId, producto, estado },
            { onConflict: 'conversacion_id,producto' })
  if (error) throw new Error(error.message)

  // SOLO al pasar a validado. Desmarcar no manda nada: una venta ya
  // reportada a Meta está reportada, y «deshacerla» no existe en el CAPI.
  // El cerrojo de la base garantiza que validar dos veces mande UN evento,
  // así que aquí no hace falta recordar el estado anterior ni comparar.
  if (estado === 'validado') {
    avisarPurchase(conversacionId).catch(() => {})
  }
}

/**
 * Quitar del todo la fila de un producto.
 *
 * Distinto de bajarlo a `interesado`: eso dice "le interesó pero no compró",
 * esto dice "este producto no pinta nada en esta conversación". Se usa
 * cuando el flujo se equivocó de producto.
 */
export async function quitarProducto(conversacionId: number, producto: string): Promise<void> {
  const { error } = await supabase
    .from('conversacion_productos').delete()
    .eq('conversacion_id', conversacionId).eq('producto', producto)
  if (error) throw new Error(error.message)
}

// ── Etiquetas ────────────────────────────────────────────────────────────

export async function leerEtiquetas(): Promise<Etiqueta[]> {
  const { data, error } = await supabase
    .from('etiquetas').select('*').order('orden').order('id')
  if (error) {
    // La tabla es de 04-esquema-favoritos-etiquetas.sql y puede no existir
    // todavía. Sin ella el inbox funciona igual, solo que sin etiquetas.
    if (esTablaAusente(error)) return []
    throw new Error(error.message)
  }
  return data ?? []
}

export async function crearEtiqueta(nombre: string, color: string): Promise<Etiqueta> {
  const { data, error } = await supabase
    .from('etiquetas')
    .insert({ nombre: nombre.trim(), color, orden: 100 })
    .select().single()
  if (error) throw new Error(traducirError(error.message, nombre))
  return data as Etiqueta
}

export async function editarEtiqueta(
  id: number, cambios: { nombre?: string; color?: string; orden?: number },
): Promise<void> {
  const limpio = { ...cambios }
  if (limpio.nombre !== undefined) limpio.nombre = limpio.nombre.trim()
  const { error } = await supabase.from('etiquetas').update(limpio).eq('id', id)
  if (error) throw new Error(traducirError(error.message, cambios.nombre ?? ''))
}

/**
 * Borrar una etiqueta la quita de TODAS las conversaciones: el
 * ON DELETE CASCADE de conversacion_etiquetas se encarga. Por eso la pantalla
 * de gestión pide confirmación diciendo a cuántas afecta.
 */
export async function borrarEtiqueta(id: number): Promise<void> {
  const { error } = await supabase.from('etiquetas').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function ponerEtiqueta(conversacionId: number, etiquetaId: number): Promise<void> {
  const { error } = await supabase
    .from('conversacion_etiquetas')
    .insert({ conversacion_id: conversacionId, etiqueta_id: etiquetaId })
  // 23505 = ya la tenía. Poner dos veces la misma etiqueta no es un error,
  // es el mismo resultado.
  if (error && error.code !== '23505') throw new Error(error.message)
}

export async function quitarEtiqueta(conversacionId: number, etiquetaId: number): Promise<void> {
  const { error } = await supabase
    .from('conversacion_etiquetas').delete()
    .eq('conversacion_id', conversacionId).eq('etiqueta_id', etiquetaId)
  if (error) throw new Error(error.message)
}

/** Cuántas conversaciones tiene cada etiqueta. Para avisar antes de borrar. */
export async function contarPorEtiqueta(): Promise<Record<number, number>> {
  const { data, error } = await supabase
    .from('conversacion_etiquetas').select('etiqueta_id')
  if (error) {
    if (esTablaAusente(error)) return {}
    throw new Error(error.message)
  }
  const cuenta: Record<number, number> = {}
  for (const f of data ?? []) {
    const id = (f as { etiqueta_id: number }).etiqueta_id
    cuenta[id] = (cuenta[id] ?? 0) + 1
  }
  return cuenta
}

function esTablaAusente(error: { code?: string; message: string }): boolean {
  return error.code === 'PGRST205' || error.code === 'PGRST200' ||
         /schema cache|relationship/i.test(error.message)
}

function traducirError(mensaje: string, nombre: string): string {
  if (/uq_etiquetas_nombre|duplicate key/i.test(mensaje)) {
    return `Ya existe una etiqueta llamada "${nombre.trim()}".`
  }
  if (/etiquetas_color_check/i.test(mensaje)) {
    return 'Ese color no está en la paleta.'
  }
  return mensaje
}

// ── Canales ──────────────────────────────────────────────────────────────
/**
 * Configuración de los números. NUNCA credenciales: el token de Meta vive
 * en /opt/bot/wa.env y no pasa por aquí. Lo que se guarda es qué números
 * existen y qué saben hacer.
 */
export async function crearCanal(c: Partial<Canal>): Promise<Canal> {
  const { data, error } = await supabase.from('canales').insert(c).select().single()
  if (error) throw new Error(traducirCanal(error.message))
  return data as Canal
}

export async function editarCanal(id: number, cambios: Partial<Canal>): Promise<void> {
  const { error } = await supabase.from('canales').update(cambios).eq('id', id)
  if (error) throw new Error(traducirCanal(error.message))
}

function traducirCanal(mensaje: string): string {
  if (/canales_tipo_identificador_key|duplicate key/i.test(mensaje)) {
    return 'Ya hay un canal con ese Phone Number ID. Cada número solo puede estar una vez.'
  }
  if (/row-level security/i.test(mensaje)) {
    return 'Falta la policy de escritura en `canales`. Ejecuta 08-multicanal.sql.'
  }
  return mensaje
}

// ── Marca de «revisado hasta aquí» ───────────────────────────────────────
/**
 * Ver 11-marca-revision.sql. Son como mucho DOS filas —una por canal—, así
 * que se leen todas de golpe y se filtran en memoria. Paginar dos filas
 * sería más código que datos.
 *
 * Si la tabla todavía no existe (SQL sin ejecutar) se devuelve vacío en vez
 * de reventar: la lista tiene que seguir pintándose sin la marca, igual que
 * hace con las etiquetas y con los canales.
 */
export async function leerMarcas(): Promise<MarcaRevision[]> {
  const { data, error } = await supabase.from('marcas_revision').select('*')
  if (error) {
    if (esTablaAusente(error)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as MarcaRevision[]
}

/**
 * Poner la marca. UNA escritura, no dos.
 *
 * El upsert va sobre `canal_id`, que es la clave primaria: marcar otra
 * conversación del mismo canal sustituye la fila. NO se borra antes la
 * anterior a propósito — borrar y volver a insertar deja un hueco en el que
 * no hay ninguna marca, y si la segunda mitad falla te quedas sin ninguna.
 *
 * `marcado_por` y `marcado_en` no se mandan: los pone el trigger desde
 * auth.uid(). Mandarlos desde el navegador sería dejar que cualquiera
 * firmara con el nombre de otro.
 */
export async function ponerMarca(canalId: number, conversacionId: number): Promise<void> {
  const { error } = await supabase
    .from('marcas_revision')
    .upsert({ canal_id: canalId, conversacion_id: conversacionId }, { onConflict: 'canal_id' })
  if (error) throw new Error(traducirMarca(error.message))
}

/** Quitar la marca de un canal. Borrar la fila ES quitarla. */
export async function quitarMarca(canalId: number): Promise<void> {
  const { error } = await supabase.from('marcas_revision').delete().eq('canal_id', canalId)
  if (error) throw new Error(traducirMarca(error.message))
}

function traducirMarca(mensaje: string): string {
  if (/relation .*marcas_revision.* does not exist|schema cache/i.test(mensaje)) {
    return 'Falta la tabla `marcas_revision`. Ejecuta 11-marca-revision.sql en Supabase.'
  }
  if (/row-level security/i.test(mensaje)) {
    return 'Falta la policy de escritura en `marcas_revision`. Ejecuta 11-marca-revision.sql.'
  }
  return mensaje
}
