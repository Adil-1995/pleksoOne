/**
 * El catálogo de emojis del selector.
 *
 * POR QUÉ UNA LISTA A MANO Y NO UNA LIBRERÍA. Las librerías de emojis
 * (emoji-mart y compañía) traen los 3 800 de Unicode con sus nombres en
 * varios idiomas: entre 300 KB y 1 MB de datos que hay que descargar antes
 * de poder pintar la primera carita. Aquí se atiende a clientes desde el
 * móvil y con datos, y esto es un inbox de ventas, no un teclado: los que
 * se usan de verdad son unos cientos. Esta lista pesa unos pocos KB, va
 * dentro del bundle y no añade una dependencia más que mantener.
 *
 * LAS PALABRAS ESTÁN EN ESPAÑOL porque quien busca aquí escribe en español.
 * Buscar «sonrisa» tiene que encontrar 😊, no «smile». Y van sin tildes
 * porque el buscador también las quita: así «anos» encuentra «años».
 *
 * Los emojis se pintan con la fuente del sistema. No se sirve ningún sprite
 * ni se pide nada a un CDN: en el móvil salen los de Android o los de iOS,
 * que es exactamente lo que el cliente va a ver al otro lado.
 */

export interface GrupoEmojis {
  id: string
  nombre: string
  /** El emoji que hace de pestaña. */
  icono: string
  /** Pares [emoji, palabras por las que se encuentra]. */
  emojis: [string, string][]
}

export const GRUPOS: GrupoEmojis[] = [
  {
    id: 'caras', nombre: 'Caras', icono: '😊',
    emojis: [
      ['😀', 'sonrisa feliz alegre'], ['😃', 'sonrisa feliz alegre'],
      ['😄', 'sonrisa feliz alegre'], ['😁', 'sonrisa dientes feliz'],
      ['😆', 'risa carcajada'], ['😅', 'risa sudor nervios'],
      ['🤣', 'risa suelo carcajada'], ['😂', 'risa llorar lagrimas'],
      ['🙂', 'sonrisa leve'], ['🙃', 'reves ironia'],
      ['😉', 'guino complice'], ['😊', 'sonrisa contento amable gracias'],
      ['😇', 'angel santo inocente'], ['🥰', 'amor corazones enamorado'],
      ['😍', 'amor ojos corazon encanta'], ['🤩', 'estrellas wow flipar'],
      ['😘', 'beso'], ['😗', 'beso'], ['😚', 'beso'], ['😙', 'beso'],
      ['😋', 'rico delicioso lengua sabroso'], ['😛', 'lengua burla'],
      ['😜', 'lengua guino broma'], ['🤪', 'loco chalado'],
      ['😝', 'lengua ojos cerrados'], ['🤑', 'dinero rico billete'],
      ['🤗', 'abrazo'], ['🤭', 'ups tapar boca'],
      ['🤫', 'silencio callar'], ['🤔', 'pensar duda dudar'],
      ['🤐', 'cremallera callado'], ['🤨', 'ceja duda sospecha'],
      ['😐', 'neutral serio'], ['😑', 'sin expresion'],
      ['😶', 'sin boca mudo'], ['😏', 'picara listillo'],
      ['😒', 'harto fastidio'], ['🙄', 'ojos arriba hartazgo'],
      ['😬', 'mueca incomodo apuro'], ['🤥', 'mentira pinocho'],
      ['😌', 'aliviado tranquilo'], ['😔', 'triste pena'],
      ['😪', 'sueno dormido'], ['🤤', 'baba antojo'],
      ['😴', 'dormir sueno'], ['😷', 'mascarilla enfermo'],
      ['🤒', 'fiebre enfermo termometro'], ['🤕', 'herido venda'],
      ['🥴', 'mareado'], ['😵', 'mareado aturdido'],
      ['🤯', 'explota cabeza flipar'], ['🥳', 'fiesta celebrar'],
      ['😎', 'gafas chulo genial'], ['🤓', 'gafas empollon'],
      ['😕', 'confuso'], ['😟', 'preocupado'], ['🙁', 'triste'],
      ['😮', 'sorpresa boca abierta'], ['😯', 'sorpresa'],
      ['😲', 'asombro impacto'], ['😳', 'sonrojado verguenza'],
      ['🥺', 'suplica porfa pena'], ['😦', 'preocupado'],
      ['😧', 'angustia'], ['😨', 'miedo susto'],
      ['😰', 'ansiedad sudor'], ['😥', 'triste alivio'],
      ['😢', 'llorar triste lagrima'], ['😭', 'llorar mucho triste'],
      ['😱', 'grito panico susto'], ['😖', 'agobio'],
      ['😣', 'esfuerzo'], ['😞', 'decepcion'],
      ['😓', 'sudor derrota'], ['😩', 'cansado harto'],
      ['😫', 'cansado agotado'], ['🥱', 'bostezo aburrido'],
      ['😤', 'enfado vapor orgullo'], ['😡', 'enfadado rojo furioso'],
      ['😠', 'enfadado'], ['🤬', 'palabrotas insulto'],
      ['🙈', 'mono ojos verguenza'], ['🙉', 'mono oidos'],
      ['🙊', 'mono boca callar'],
    ],
  },
  {
    id: 'gestos', nombre: 'Gestos', icono: '👍',
    emojis: [
      ['👍', 'bien ok pulgar arriba vale genial'],
      ['👎', 'mal pulgar abajo no'],
      ['👌', 'ok perfecto vale'], ['🤌', 'dedos italiano'],
      ['✌️', 'paz victoria'], ['🤞', 'suerte cruzados'],
      ['🤟', 'te quiero'], ['🤘', 'cuernos rock'],
      ['🤙', 'llamame'], ['👈', 'izquierda senalar'],
      ['👉', 'derecha senalar'], ['👆', 'arriba senalar'],
      ['👇', 'abajo senalar aqui'], ['☝️', 'arriba uno atencion'],
      ['✋', 'mano alto para'], ['🤚', 'mano'],
      ['🖐️', 'mano dedos'], ['🖖', 'spock'],
      ['👋', 'hola adios saludo saludar'],
      ['🤝', 'trato acuerdo apreton manos'],
      ['🙏', 'gracias porfavor rezar suplica'],
      ['👏', 'aplauso bravo felicidades'],
      ['🙌', 'manos arriba celebrar'],
      ['👐', 'manos abiertas'], ['🤲', 'manos juntas'],
      ['💪', 'fuerza musculo animo'],
      ['🫶', 'corazon manos'], ['✍️', 'escribir'],
      ['🤷', 'ni idea encogerse'], ['🤦', 'facepalm verguenza'],
      ['💅', 'unas'], ['👀', 'ojos mirar atento'],
    ],
  },
  {
    id: 'corazones', nombre: 'Corazones', icono: '❤️',
    emojis: [
      ['❤️', 'corazon rojo amor'], ['🧡', 'corazon naranja'],
      ['💛', 'corazon amarillo'], ['💚', 'corazon verde'],
      ['💙', 'corazon azul'], ['💜', 'corazon morado'],
      ['🖤', 'corazon negro'], ['🤍', 'corazon blanco'],
      ['🤎', 'corazon marron'], ['💔', 'corazon roto'],
      ['❣️', 'corazon exclamacion'], ['💕', 'dos corazones'],
      ['💞', 'corazones girando'], ['💓', 'corazon latiendo'],
      ['💗', 'corazon creciendo'], ['💖', 'corazon brillante'],
      ['💘', 'corazon flecha cupido'], ['💝', 'corazon regalo lazo'],
      ['💯', 'cien perfecto total'], ['✨', 'brillos chispas nuevo'],
      ['⭐', 'estrella'], ['🌟', 'estrella brillante'],
      ['🔥', 'fuego arde exito'], ['💥', 'explosion'],
      ['🎉', 'fiesta confeti celebrar'], ['🎊', 'confeti fiesta'],
      ['🎁', 'regalo obsequio'], ['🏆', 'trofeo ganar premio'],
      ['🥇', 'oro primero medalla'],
    ],
  },
  {
    id: 'venta', nombre: 'Venta', icono: '📦',
    emojis: [
      ['📦', 'paquete caja envio pedido'],
      ['🚚', 'camion envio reparto entrega'],
      ['🛵', 'moto reparto repartidor'],
      ['✈️', 'avion envio'], ['🚀', 'cohete rapido'],
      ['🏠', 'casa domicilio'], ['🏡', 'casa hogar'],
      ['📍', 'ubicacion direccion pin'],
      ['🗺️', 'mapa'], ['🧭', 'brujula'],
      ['💰', 'dinero bolsa precio'], ['💵', 'billete efectivo pago'],
      ['💸', 'dinero volando gasto'], ['💳', 'tarjeta pago'],
      ['🧾', 'recibo factura ticket'],
      ['🛒', 'carrito compra'], ['🛍️', 'bolsas compras'],
      ['🏷️', 'etiqueta precio oferta'],
      ['📲', 'movil whatsapp escribir'], ['📱', 'movil telefono'],
      ['☎️', 'telefono llamar'], ['📞', 'telefono llamada'],
      ['📸', 'foto camara'], ['📷', 'camara foto'],
      ['🎥', 'video camara'], ['📺', 'television pantalla'],
      ['💡', 'idea bombilla luz'], ['🔌', 'enchufe corriente'],
      ['🔋', 'bateria pila'], ['⚡', 'rayo energia rapido'],
      ['🧊', 'hielo frio'], ['💧', 'agua gota'],
      ['🚿', 'ducha'], ['🧼', 'jabon limpieza'],
      ['🧹', 'escoba limpiar'], ['🪑', 'silla mueble'],
      ['🛏️', 'cama'], ['🪟', 'ventana'],
      ['⌚', 'reloj pulsera'], ['⏰', 'despertador hora'],
      ['📅', 'calendario fecha dia'], ['📆', 'calendario'],
      ['⏳', 'esperar tiempo reloj arena'],
      ['✅', 'listo hecho correcto tick confirmado'],
      ['☑️', 'marcado casilla'], ['✔️', 'tick correcto'],
      ['❌', 'no error mal cancelado'], ['⛔', 'prohibido stop'],
      ['⚠️', 'aviso atencion cuidado'],
      ['❗', 'exclamacion importante'], ['❓', 'pregunta duda'],
      ['🆕', 'nuevo'], ['🆓', 'gratis'], ['🔝', 'top arriba'],
      ['🔎', 'buscar lupa'], ['📝', 'nota escribir apuntar'],
      ['📄', 'documento hoja'], ['📌', 'chincheta fijar'],
    ],
  },
  {
    id: 'varios', nombre: 'Varios', icono: '🌞',
    emojis: [
      ['☀️', 'sol dia'], ['🌞', 'sol cara'], ['🌙', 'luna noche'],
      ['⛅', 'nubes'], ['🌧️', 'lluvia'], ['❄️', 'nieve frio'],
      ['🌈', 'arcoiris'], ['🌸', 'flor cerezo'], ['🌹', 'rosa flor'],
      ['🌻', 'girasol'], ['🌱', 'planta brote'], ['🌿', 'hoja planta'],
      ['🍀', 'trebol suerte'], ['🐶', 'perro'], ['🐱', 'gato'],
      ['☕', 'cafe'], ['🍵', 'te infusion'], ['🍺', 'cerveza'],
      ['🥤', 'refresco bebida vaso'], ['🍕', 'pizza'],
      ['🍔', 'hamburguesa'], ['🌮', 'taco'], ['🌯', 'burrito'],
      ['🥑', 'aguacate'], ['🍎', 'manzana'], ['🍰', 'tarta pastel'],
      ['🎂', 'cumpleanos tarta'], ['🇲🇽', 'mexico bandera'],
      ['🇪🇸', 'espana bandera'], ['👶', 'bebe'], ['👩', 'mujer'],
      ['👨', 'hombre'], ['👪', 'familia'], ['🎵', 'musica nota'],
      ['🔊', 'sonido altavoz'], ['🔇', 'silencio mudo'],
      ['🔒', 'candado cerrado seguro'], ['🔑', 'llave'],
      ['♻️', 'reciclar'], ['🆗', 'ok'], ['🙋', 'levantar mano pregunta'],
    ],
  },
]

/** El histórico de lo que más se usa. Por aparato, y a propósito: es una
 *  comodidad del dedo, no un dato del equipo que haya que compartir. */
const CLAVE_RECIENTES = 'pleksone.emojis.recientes'
const MAX_RECIENTES = 24

export function leerRecientes(): string[] {
  try {
    const crudo = localStorage.getItem(CLAVE_RECIENTES)
    if (!crudo) return []
    const v = JSON.parse(crudo)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_RECIENTES) : []
  } catch {
    // Modo incógnito, almacenamiento lleno o JSON corrupto: sin recientes se
    // vive igual. Que el selector no abra por esto sería absurdo.
    return []
  }
}

export function apuntarReciente(emoji: string): string[] {
  const lista = [emoji, ...leerRecientes().filter((e) => e !== emoji)].slice(0, MAX_RECIENTES)
  try { localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(lista)) } catch { /* da igual */ }
  return lista
}

function sinTildes(t: string): string {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Busca por palabra. Devuelve los emojis de todos los grupos que encajen,
 * sin repetir: un emoji puede estar en dos grupos y verlo dos veces en los
 * resultados haría pensar que hay dos distintos.
 */
export function buscarEmojis(consulta: string): string[] {
  const q = sinTildes(consulta).trim()
  if (!q) return []
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const g of GRUPOS) {
    for (const [emoji, palabras] of g.emojis) {
      if (vistos.has(emoji)) continue
      if (sinTildes(palabras).includes(q)) { vistos.add(emoji); salida.push(emoji) }
    }
  }
  return salida
}

/**
 * Inserta un emoji donde está el cursor.
 *
 * Devuelve el texto nuevo y dónde tiene que quedarse el cursor. Se calcula
 * aquí, en una función pura, y no dentro del componente, porque es lo único
 * de esto que puede romperse en silencio: si el emoji se fuera siempre al
 * final, escribir «Hola|, gracias», abrir el selector y elegir uno lo
 * pondría en el sitio equivocado y no lo verías hasta después de enviarlo.
 *
 * Con texto seleccionado, lo SUSTITUYE, que es lo que hace cualquier campo
 * de texto cuando escribes teniendo algo marcado.
 */
export function insertarEmoji(
  texto: string, emoji: string, desde: number, hasta: number,
): { texto: string; cursor: number } {
  const a = Math.max(0, Math.min(desde, texto.length))
  const b = Math.max(a, Math.min(hasta, texto.length))
  return {
    texto: texto.slice(0, a) + emoji + texto.slice(b),
    cursor: a + emoji.length,
  }
}
