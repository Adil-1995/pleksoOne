import type { Canal, Conversacion } from '@/tipos'

/**
 * Todo lo que la interfaz necesita saber para decidir qué puede hacer.
 *
 * REGLA DE ORO: nadie fuera de este fichero pregunta "¿es WhatsApp?".
 * Se pregunta por capacidades. Cuando entre Instagram, esto sigue igual.
 */
export interface Capacidades {
  puedeEnviarMedia: boolean
  tieneVentana: boolean
  ventanaHoras: number
  puedePlantillas: boolean
  activo: boolean
  nombre: string
  /** Solo para pintar el iconito y el color. Nunca para decidir comportamiento. */
  etiqueta: string
}

const POR_DEFECTO: Capacidades = {
  puedeEnviarMedia: false,
  tieneVentana: false,
  ventanaHoras: 0,
  puedePlantillas: false,
  activo: false,
  nombre: 'Canal desconocido',
  etiqueta: '?',
}

const ETIQUETAS: Record<string, string> = {
  whatsapp_cloud: 'WA',
  evolution: 'EV',
  instagram: 'IG',
  messenger: 'MS',
  email: '@',
}

/**
 * PUENTE TEMPORAL, quítalo cuando `canales` esté poblada.
 *
 * Si la tabla `canales` todavía no existe (02-esquema-canales.sql sin ejecutar),
 * no hay de dónde sacar las capacidades. En vez de enseñar "Canal desconocido"
 * y desactivar media, se deducen del campo de texto `canal` que ya escribe n8n.
 *
 * Esto SÍ pregunta "¿es WhatsApp?", que es justo lo que la regla de oro prohíbe.
 * Es deuda consciente y acotada a este bloque: en cuanto exista la fila en
 * `canales`, manda ella y esto no se usa.
 */
const LEGADO: Record<string, Omit<Capacidades, 'etiqueta'>> = {
  whatsapp_cloud: {
    puedeEnviarMedia: true, tieneVentana: true, ventanaHoras: 24,
    puedePlantillas: true, activo: true, nombre: 'WhatsApp',
  },
  evolution: {
    puedeEnviarMedia: true, tieneVentana: false, ventanaHoras: 0,
    puedePlantillas: false, activo: false, nombre: 'Evolution (retirado)',
  },
}

/**
 * ¿María contesta por este canal?
 *
 * `undefined` = columna todavía sin crear = sí contesta. Se lee siempre por
 * aquí, nunca `canal.bot_activo` a pelo: la diferencia entre `=== false` y
 * `!` es, literalmente, que el bot se calle con todos los clientes por una
 * migración a medias.
 */
/**
 * Distintivo corto del canal: el país si lo tiene, y si no las dos primeras
 * letras del nombre. Con tres o cuatro números, "MX" y "ES" se distinguen de
 * un vistazo y ocupan lo que ocupa nada.
 */
export function distintivo(canal: Canal): string {
  if (canal.pais) return canal.pais.toUpperCase()
  return canal.nombre.replace(/[^A-Za-zÁÉÍÓÚÑ]/gi, '').slice(0, 2).toUpperCase() || '?'
}

export function mariaAtiende(canal: Canal | undefined | null): boolean {
  return !canal || canal.bot_activo !== false
}

export function capacidadesDe(
  canal: Canal | undefined | null,
  canalLegado?: string | null,
): Capacidades {
  if (!canal) {
    const l = canalLegado ? LEGADO[canalLegado] : undefined
    if (l) return { ...l, etiqueta: ETIQUETAS[canalLegado!] ?? '?' }
    return POR_DEFECTO
  }
  return {
    puedeEnviarMedia: canal.soporta_media,
    tieneVentana: canal.ventana_horas > 0,
    ventanaHoras: canal.ventana_horas,
    puedePlantillas: canal.soporta_plantillas,
    activo: canal.activo,
    nombre: canal.nombre,
    etiqueta: ETIQUETAS[canal.tipo] ?? canal.tipo.slice(0, 2).toUpperCase(),
  }
}

export interface EstadoVentana {
  aplica: boolean
  abierta: boolean
  horasRestantes: number
  minutosRestantes: number
  /** Menos de 2 h: hay que avisar. */
  avisar: boolean
}

/**
 * Cuánto queda de la ventana de servicio.
 * Se cuenta desde el ÚLTIMO mensaje DEL CLIENTE, no desde el último mensaje:
 * responderle no reabre la ventana.
 */
export function estadoVentana(
  conv: Conversacion,
  cap: Capacidades,
  ahora: Date = new Date(),
): EstadoVentana {
  if (!cap.tieneVentana || !conv.ultimo_del_cliente) {
    return { aplica: cap.tieneVentana, abierta: !cap.tieneVentana, horasRestantes: 0, minutosRestantes: 0, avisar: false }
  }
  const desde = new Date(conv.ultimo_del_cliente).getTime()
  const finMs = desde + cap.ventanaHoras * 3600_000
  const restanteMs = finMs - ahora.getTime()
  const abierta = restanteMs > 0
  const totalMin = Math.max(0, Math.floor(restanteMs / 60_000))
  return {
    aplica: true,
    abierta,
    horasRestantes: Math.floor(totalMin / 60),
    minutosRestantes: totalMin % 60,
    avisar: abierta && restanteMs < 2 * 3600_000,
  }
}

/** Límites de tamaño por tipo, en bytes. Los impone WhatsApp Cloud API. */
export const LIMITES_MEDIA = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
} as const

export function limiteDe(tipo: keyof typeof LIMITES_MEDIA): number {
  return LIMITES_MEDIA[tipo]
}
