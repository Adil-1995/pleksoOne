import { supabase } from './supabase'
import { nombreSeguro } from './media'

/**
 * ENVÍO — el frontend NUNCA habla con la Cloud API ni escribe en `mensajes`.
 *
 * Llama a un webhook de n8n que a su vez llama al subflujo
 * "LumaBot — Salida WhatsApp (punto único)" (fUnaKZ51BWB2qJ7U).
 * Un único punto de salida, regla 2: el token de Meta vive solo ahí.
 *
 * Por eso tampoco hay policy de INSERT en `mensajes`: aunque alguien
 * robase la anon key, no podría escribir mensajes falsos en el hilo.
 */

const URL_ENVIO = import.meta.env.VITE_WEBHOOK_ENVIO as string | undefined

export interface PeticionEnvio {
  cliente_id: string
  accion: 'texto' | 'imagen' | 'video' | 'documento' | 'audio' | 'bloquear' | 'desbloquear' | 'aviso_canal'
  texto?: string
  media_url?: string
  /**
   * Nombre real del fichero. WhatsApp lo enseña como título del documento;
   * sin él, al cliente le llega un PDF llamado "1787391234.pdf".
   */
  nombre_fichero?: string
  /** Bytes, para pintar el peso en la burbuja sin volver a descargar nada. */
  tamano?: number
  /** Primer fotograma del vídeo, ya subido: hace de `poster` del reproductor. */
  miniatura_url?: string
  /** Solo para `aviso_canal`. */
  canal_id?: number
  pausado?: boolean
}

export interface RespuestaEnvio {
  ok: boolean
  wamid?: string
  error?: string
}

export async function enviar(p: PeticionEnvio): Promise<RespuestaEnvio> {
  if (!URL_ENVIO) {
    return { ok: false, error: 'Falta VITE_WEBHOOK_ENVIO en .env.local' }
  }

  // El token del usuario viaja en la cabecera: n8n puede comprobar que
  // quien envía es alguien del equipo, no cualquiera con la URL.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  try {
    const r = await fetch(URL_ENVIO, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...p, autor: 'humano' }),
    })

    if (!r.ok) {
      return { ok: false, error: `El servidor respondió ${r.status}` }
    }
    const j = await r.json().catch(() => ({}))
    // El subflujo devuelve { ok, wamid, error }
    if (j && typeof j.ok === 'boolean') {
      return { ok: j.ok, wamid: j.wamid, error: j.error ? String(j.error) : undefined }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error de red' }
  }
}

/**
 * BLOQUEAR o DESBLOQUEAR de verdad, en la Cloud API.
 *
 * Va por n8n y no directo a Supabase, aunque acabe escribiendo en
 * `conversaciones`: el bloqueo real lo hace Meta con
 * POST/DELETE /{PHONE_ID}/block_users, y ese token no puede vivir en el
 * frontend. n8n llama a Meta, y solo si Meta dice que sí escribe la columna.
 * Así la base de datos nunca dice "bloqueada" de alguien que sigue pudiendo
 * escribirte.
 *
 * LÍMITE DE META: solo se puede bloquear a quien te haya escrito en las
 * últimas 24 h. Fuera de esa ventana devuelve el error 131047 y no bloquea.
 */
export async function bloquear(clienteId: string, bloquear: boolean): Promise<RespuestaEnvio> {
  return enviar({
    cliente_id: clienteId,
    accion: bloquear ? 'bloquear' : 'desbloquear',
  })
}

/**
 * AVISO A INCIDENCIAS de que María se ha callado (o ha vuelto) en un canal.
 *
 * El cambio ya está guardado cuando esto se llama: el aviso es notificación,
 * no confirmación. Va por n8n porque el token de Telegram vive en el
 * servidor, y `cliente_id` viaja vacío a propósito — esto no es un mensaje
 * a nadie, es una nota interna.
 *
 * Que falle el aviso NO deshace la pausa. Quedarse sin interruptor por no
 * poder avisar sería peor que quedarse sin aviso.
 */
export async function avisarPausaCanal(canalId: number, pausado: boolean): Promise<RespuestaEnvio> {
  return enviar({ cliente_id: '', accion: 'aviso_canal', canal_id: canalId, pausado })
}

/**
 * Pausar o reactivar el bot. Esto SÍ va directo a Supabase: es un UPDATE
 * sobre `conversaciones`, que la policy `equipo_edita_conv` permite.
 */
export async function ponerBot(clienteId: string, activo: boolean): Promise<void> {
  const { error } = await supabase
    .from('conversaciones')
    .update({ bot_activo: activo })
    .eq('cliente_id', clienteId)
  if (error) throw new Error(error.message)
}

/** Poner a cero el contador al abrir la conversación. */
export async function marcarLeida(clienteId: string): Promise<void> {
  await supabase.from('conversaciones').update({ no_leidos: 0 }).eq('cliente_id', clienteId)
}

/**
 * Sube un fichero al Storage y devuelve su URL pública.
 * El envío real lo hace n8n: la Cloud API no acepta ficheros directos,
 * necesita primero POST /{PHONE_ID}/media para obtener un media_id.
 * Nosotros le pasamos una URL y n8n se encarga.
 */
export async function subirMedia(
  clienteId: string,
  file: File,
  onProgreso?: (pct: number) => void,
): Promise<{ url: string; path: string }> {
  // El nombre original viaja DENTRO de la ruta, detrás del sello de tiempo.
  // Así el hilo puede enseñar "Catalogo-2026.pdf" sin una columna nueva en
  // `adjuntos`, y el sello sigue evitando colisiones. Ver nombreDeRuta().
  const path = `salientes/${clienteId}/${Date.now()}-${nombreSeguro(file.name)}`

  // supabase-js no expone progreso de subida todavía; lo simulamos en dos
  // tramos para que la barra no se quede muerta en fichero grande.
  onProgreso?.(10)
  const { error } = await supabase.storage.from('media').upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  onProgreso?.(100)

  const { data } = supabase.storage.from('media').getPublicUrl(path)
  return { url: data.publicUrl, path }
}

/**
 * Sube el fotograma que `miniaturaDeVideo` sacó en el navegador y devuelve
 * su URL pública, para usarla de `poster` del reproductor.
 *
 * Sin poster, un vídeo recién enviado se pinta como un rectángulo negro
 * hasta que alguien le da al play. Si algo falla aquí no se corta el envío:
 * el vídeo importa, la miniatura es un adorno.
 */
export async function subirMiniatura(
  clienteId: string,
  dataUrl: string,
): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const path = `salientes/${clienteId}/${Date.now()}-miniatura.jpg`
    const { error } = await supabase.storage
      .from('media')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) return null
    return supabase.storage.from('media').getPublicUrl(path).data.publicUrl
  } catch {
    return null
  }
}
