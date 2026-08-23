// Tipos que reflejan el esquema de Supabase.
// Si cambia el SQL, cambia esto y TypeScript te dice dónde duele.

export type Direccion = 'in' | 'out'
export type Autor = 'cliente' | 'bot' | 'humano' | 'sistema'
export type TipoMensaje =
  | 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'template' | 'sticker'
export type EstadoMensaje = 'pendiente' | 'enviado' | 'entregado' | 'leido' | 'error'

/**
 * Un canal por el que se habla con el cliente.
 *
 * REGLA DE ORO: el frontend nunca mira `tipo` para decidir qué puede hacer.
 * Mira las CAPACIDADES. Añadir Instagram es insertar una fila, no tocar código.
 * `tipo` solo se usa para pintar el iconito y poco más.
 */
export interface Canal {
  id: number
  /** whatsapp_cloud hoy; instagram y messenger cuando toque. */
  tipo: string
  /** El phone_number_id de Meta. Es la llave por la que el webhook lo reconoce. */
  identificador: string
  nombre: string
  pais: string | null
  ventana_horas: number      // 0 = sin ventana
  soporta_media: boolean
  soporta_plantillas: boolean
  activo: boolean
  /**
   * Interruptor maestro de María para ESTE número.
   *
   * Opcional a propósito: mientras 09-pausa-canal.sql no esté ejecutado la
   * columna no existe y llega `undefined`. Por eso nadie lee este campo a
   * pelo — se lee con `mariaAtiende()`, que trata "no sé" como "sí atiende".
   * Al revés, un fallo de esquema dejaría al bot mudo en todos los números
   * sin que nadie lo hubiera pedido.
   */
  bot_activo?: boolean
  pausado_por?: string | null
  pausado_en?: string | null
  waba_id: string | null
  /** Doc con la parte del prompt propia del canal. Vacío = solo el común. */
  prompt_url: string | null
  /** Pestaña del Sheet de catálogo. Vacío = la de por defecto. */
  catalogo_hoja: string | null
  notas: string | null
  orden: number
}

/** Los tipos de canal que el inbox sabe nombrar. Añadir uno es una fila. */
export const TIPOS_CANAL = [
  { id: 'whatsapp_cloud', nombre: 'WhatsApp Cloud API', listo: true },
  { id: 'instagram',      nombre: 'Instagram',          listo: false },
  { id: 'messenger',      nombre: 'Messenger',          listo: false },
  { id: 'evolution',      nombre: 'Evolution (retirado)', listo: false },
] as const

export interface Conversacion {
  id: number
  cliente_id: string         // la identidad. Nunca el teléfono formateado (regla 3)
  telefono: string | null
  nombre: string | null
  ultimo_texto: string | null
  ultimo_en: string | null
  ultimo_del_cliente: string | null
  no_leidos: number
  bot_activo: boolean
  ctwa_clid: string | null
  ad_id: string | null
  creado: string
  canal: string | null
  canal_id: number | null

  // ── 04-esquema-favoritos-etiquetas.sql ──
  favorita: boolean
  /** Va arriba del todo, por encima del orden por fecha. Distinto de favorita. */
  fijada: boolean
  /** Entra y se guarda, pero María calla y no salta alerta. Reversible. */
  silenciada: boolean
  /** Bloqueo real en la Cloud API: el mensaje ni llega. */
  bloqueada: boolean
  bloqueada_en: string | null
  bloqueo_nota: string | null
  /** Llega por embed de PostgREST a través de conversacion_etiquetas. */
  etiquetas?: Etiqueta[]
  /** Productos que toca esta conversación. Lo rellena el flujo, nunca a mano. */
  conversacion_productos?: ProductoConversacion[]
}

/**
 * TRES estados, y los tres tienen un dueño claro:
 *
 *   interesado  ← "Decidir ficha". Recibió la ficha y nada más.
 *   pendiente   ← "Guardar pedido". El flujo ha detectado un pedido.
 *   validado    ← una persona desde el inbox. Es una venta de verdad.
 *
 * La frontera entre `pendiente` y `validado` es la que importa: separa lo
 * que la máquina CREE de lo que alguien ha CONFIRMADO. Antes iban en el
 * mismo valor ('comprado') y no había forma de distinguirlas al cuadrar.
 *
 * Sigue sin haber "negociando" ni "descartado": exigirían leerle la
 * intención al cliente en texto libre, y un estado guardado que se
 * equivoca no se corrige solo.
 */
export type EstadoProducto = 'interesado' | 'pendiente' | 'validado'

export interface ProductoConversacion {
  id: number
  conversacion_id: number
  /** El id del catálogo: lucessolares, soporte360, cojinalivia, glowbrush. */
  producto: string
  estado: EstadoProducto
  creado: string
  actualizado: string
  /** NULL = lo puso el flujo de n8n. UUID = lo corrigió una persona. */
  marcado_por: string | null
  marcado_en: string | null
  /** Quién dio el visto bueno al pedido. Solo con estado = 'validado'. */
  validado_por: string | null
  validado_en: string | null
}

export interface Etiqueta {
  id: number
  nombre: string
  /** Uno de COLORES_ETIQUETA. La base de datos lo impone con un CHECK. */
  color: string
  orden: number
}

/**
 * Por dónde iba el equipo repasando la lista. Ver 11-marca-revision.sql.
 *
 * UNA por canal como máximo, y eso no es una convención de aquí: `canal_id`
 * es la clave primaria de la tabla. Marcar otra conversación del mismo canal
 * es un upsert que SUSTITUYE la fila, no dos escrituras que puedan quedarse
 * a medias. El frontend no tiene que acordarse de quitar la anterior.
 */
export interface MarcaRevision {
  canal_id: number
  conversacion_id: number
  /** Quién la puso. NULL = no se pudo saber. Lo escribe un trigger. */
  marcado_por: string | null
  marcado_en: string
}

/**
 * El estado de una conversación, en UN solo valor.
 *
 * Se calcula en un sitio y se pinta igual en la lista y en la cabecera. Antes
 * había que mirar `bot_activo` por un lado y ahora además `silenciada` y
 * `bloqueada`: con tres booleanos sueltos, cada componente acabaría
 * interpretándolos a su manera y en algún sitio saldría "atendiendo" una
 * conversación bloqueada.
 *
 * El orden importa: bloqueada gana a silenciada, y silenciada gana a pausada.
 */
export type EstadoConversacion = 'atendiendo' | 'pausada' | 'silenciada' | 'bloqueada'

export function estadoDe(c: Pick<Conversacion, 'bot_activo' | 'silenciada' | 'bloqueada'>): EstadoConversacion {
  if (c.bloqueada) return 'bloqueada'
  if (c.silenciada) return 'silenciada'
  if (!c.bot_activo) return 'pausada'
  return 'atendiendo'
}

export interface Adjunto {
  id: number
  mensaje_id: number
  tipo: 'image' | 'audio' | 'video' | 'document' | 'sticker'
  storage_path: string
  tamano: number | null
  duracion: number | null
  transcripcion: string | null
  miniatura: string | null
  /**
   * Solo en los mensajes optimistas: mientras sube, la ruta es un blob: y de
   * ahí no se puede sacar el nombre. En los que vienen de la base de datos no
   * existe esta columna — el nombre se deduce de `storage_path`, que lo lleva
   * detrás del sello de tiempo. Ver nombreDeRuta() en lib/media.ts.
   */
  nombre_fichero?: string | null
}

export interface Mensaje {
  id: number
  cliente_id: string
  direccion: Direccion
  autor: Autor
  tipo: TipoMensaje
  texto: string | null
  media_url: string | null
  transcripcion: string | null
  estado: EstadoMensaje
  msg_id_canal: string | null
  creado: string
  canal: string | null
  adjuntos?: Adjunto[]
}

/** Mensaje que aún no ha confirmado el servidor: se pinta con un reloj. */
export interface MensajeOptimista extends Omit<Mensaje, 'id'> {
  id: number            // negativo, para no chocar con los reales
  optimista: true
  fallo?: string
}

export type MensajeEnLista = Mensaje | MensajeOptimista

export function esOptimista(m: MensajeEnLista): m is MensajeOptimista {
  return (m as MensajeOptimista).optimista === true
}
