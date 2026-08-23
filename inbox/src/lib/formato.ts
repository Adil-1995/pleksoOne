import { format, isToday, isYesterday, differenceInCalendarDays } from 'date-fns'
import { es } from 'date-fns/locale'

/** Hora corta para la lista: hoy la hora, ayer "Ayer", más atrás la fecha. */
export function horaLista(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Ayer'
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEE', { locale: es })
  return format(d, 'dd/MM/yy')
}

export function horaMensaje(iso: string): string {
  return format(new Date(iso), 'HH:mm')
}

/** Separador de día dentro del hilo. */
export function etiquetaDia(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return 'Hoy'
  if (isYesterday(d)) return 'Ayer'
  return format(d, "d 'de' MMMM yyyy", { locale: es })
}

export function mismoDia(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export function duracion(segundos: number | null): string {
  if (!segundos && segundos !== 0) return ''
  const m = Math.floor(segundos / 60)
  const s = Math.floor(segundos % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function pesoLegible(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * El número, legible. A partir de ahora `cliente_id` es el identificador
 * PRINCIPAL en la lista y en la cabecera, y un churro de trece dígitos
 * seguidos no se lee de un vistazo.
 *
 * No se inventa nada: solo se agrupa lo que encaja con un patrón conocido.
 * Si no encaja, se devuelve entero con un `+` delante. Un número agrupado
 * mal, que parezca otro, sería peor que uno sin agrupar.
 *
 * El dato NO cambia, esto es solo cómo se pinta. Para pegarlo en el `curl`
 * de la pausa hace falta el `cliente_id` crudo, y por eso va siempre en el
 * `title` de donde se enseña.
 */
export function telefonoLegible(clienteId: string): string {
  const d = String(clienteId ?? '').replace(/\D/g, '')
  if (!d) return ''
  // México: el wa_id viene CON el 1 detrás del 52 (13 dígitos).
  if (d.length === 13 && d.startsWith('521')) return `+52 1 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`
  if (d.length === 12 && d.startsWith('52')) return `+52 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  // España: 34 + 9 dígitos.
  if (d.length === 11 && d.startsWith('34')) return `+34 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  return '+' + d
}

/** Iniciales para el avatar. No hay foto, y no la va a haber: ver COLORES. */
export function iniciales(nombre: string | null, clienteId: string): string {
  const base = (nombre || '').trim()
  if (!base) return clienteId.slice(-2)
  const partes = base.split(/\s+/).filter(Boolean)
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/**
 * PALETA CERRADA del avatar. Dieciséis colores y ni uno más.
 *
 * La Cloud API NO da la foto de perfil del cliente: el webhook solo trae
 * `contacts[].profile.name`, y no hay endpoint de Graph que la sirva —un
 * `wa_id` ni siquiera es un objeto del grafo—. Así que el avatar es esto y
 * va a seguir siendo esto: unas iniciales sobre un color.
 *
 * Por eso el color tiene que trabajar. Sale del NÚMERO, que es el único dato
 * que no cambia nunca: el nombre de WhatsApp lo edita el cliente cuando
 * quiere, y un avatar que cambia de color al hacerlo deja de servir para
 * reconocer a nadie.
 *
 * Los dieciséis están medidos contra el blanco del texto: el peor da 4.92:1,
 * por encima del 4.5:1 de la WCAG AA. Antes eran siete pastel con el texto
 * en color de FONDO, que sobre el verde claro y en tema claro no se leía.
 */
const COLORES = [
  '#b91c1c', '#c2410c', '#a16207', '#4d7c0f',
  '#15803d', '#047857', '#0f766e', '#0e7490',
  '#0369a1', '#1d4ed8', '#4338ca', '#6d28d9',
  '#7e22ce', '#a21caf', '#be185d', '#be123c',
]

/**
 * Color estable por cliente. Mismo número, mismo color siempre y en todas
 * las pantallas: no se guarda en ningún sitio, se calcula.
 *
 * FNV-1a sobre los DÍGITOS, no sobre la cadena tal cual. Todos los números
 * mexicanos empiezan por `521`, así que hay que mezclar de verdad para que
 * los colores no se apelotonen; y normalizar a dígitos hace que el mismo
 * número escrito con `+` o con espacios caiga en el mismo color.
 */
export function colorAvatar(clienteId: string): string {
  const d = String(clienteId ?? '').replace(/\D/g, '') || '0'
  let h = 0x811c9dc5
  for (let i = 0; i < d.length; i++) {
    h ^= d.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return COLORES[h % COLORES.length]
}

/** Lo que se enseña en la lista cuando el último mensaje no es texto. */
export function resumen(texto: string | null, tipo?: string): string {
  if (texto && texto.trim()) return texto.replace(/\s+/g, ' ').trim()
  const etiquetas: Record<string, string> = {
    image: '📷 Foto', audio: '🎤 Audio', video: '🎥 Vídeo',
    document: '📄 Documento', sticker: '🌟 Sticker', location: '📍 Ubicación',
  }
  return (tipo && etiquetas[tipo]) || ''
}
