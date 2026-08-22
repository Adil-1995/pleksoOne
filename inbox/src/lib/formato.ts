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

/** Iniciales para el avatar cuando no hay foto. */
export function iniciales(nombre: string | null, clienteId: string): string {
  const base = (nombre || '').trim()
  if (!base) return clienteId.slice(-2)
  const partes = base.split(/\s+/).filter(Boolean)
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/** Color estable por cliente, para que el avatar no cambie entre recargas. */
const COLORES = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#faa774', '#6ec9cb']
export function colorAvatar(clienteId: string): string {
  let h = 0
  for (let i = 0; i < clienteId.length; i++) h = (h * 31 + clienteId.charCodeAt(i)) >>> 0
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
