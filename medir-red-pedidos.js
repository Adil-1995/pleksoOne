#!/usr/bin/env node
/**
 * ¿Cuántos pedidos se pueden haber perdido porque «¿Esperando datos?» lleva
 * roto desde la migración a Cloud API?
 *
 * EL FALLO
 *   `¿Pedido completo?` es un OR:
 *     output.includes('[PEDIDO]')                              <- via principal
 *     || ( esperando > 0 && !texto.includes('?')
 *          && ( /\d/.test(texto) || palabras >= 3 ) )          <- LA RED
 *
 *   `esperando` sale de un nodo Postgres que consulta n8n_chat_histories con
 *   session_id = 'lumabot-' + numero_cliente. En esa tabla hay 9333 filas y
 *   TODAS empiezan por 'rosy-'. Con 'lumabot-': cero. Asi que `esperando` es
 *   siempre 0 y la segunda mitad del OR nunca ha sido cierta.
 *
 * COMO SE MIDE
 *   La red estaba pensada para el cliente que manda sus datos de envio y el
 *   modelo se olvida del marcador. Se reconstruye el caso:
 *
 *     1. Salientes en los que Maria PIDE los datos: los tres literales que
 *        busca el propio nodo ('para preparar el env', 'necesito estos
 *        datos', 'datos de env').
 *     2. Lo que contesto el cliente DESPUES de esa peticion.
 *     3. Si esa respuesta habria disparado la red (la condicion exacta del
 *        nodo, copiada tal cual).
 *     4. Si acabo habiendo pedido de verdad: fila en `pedidos` (appdb) o
 *        estado pendiente/validado en conversacion_productos.
 *
 *   El candidato a pedido perdido es: Maria pidio los datos, el cliente
 *   contesto algo que la red habria cazado, y NO hay pedido.
 *
 * LO QUE ESTO NO ES
 *   Una lista de ventas perdidas. Un cliente puede contestar «ok gracias» y
 *   no comprar nunca, y eso cuenta como disparo de la red pero no como
 *   pedido perdido. Por eso se separan tres niveles de exigencia, del mas
 *   flojo al mas estricto, y el que hay que mirar es el ultimo.
 */
const fs = require('fs')
const path = require('path')

const DIR = process.argv[2]
if (!DIR) { console.error('uso: node medir-red-pedidos.js <directorio-datos>'); process.exit(1) }

function cargar(f) {
  const bruto = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\n/g, '')
  return JSON.parse(bruto.replace(/\]\s*\[/g, ','))
}

const mensajes = cargar('mensajes.ndjson')
const convProd = cargar('cp.json')
const convs = cargar('cv.json')

// pedidos: telefono|fecha|producto
//
// OJO CON LA FECHA. El `OF` de to_char escribe el huso como «+00», y
// Date.parse('...T15:35:17+00') devuelve NaN — no falla, devuelve NaN. Y
// como toda comparacion con NaN es false, TODOS los pedidos se volvian
// invisibles y cualquier cliente parecia no tener pedido. La primera vez
// que se corrio esto dio 66 «perdidos», y el primero de la lista tenia su
// pedido registrado en el mismo minuto. Se normaliza a «+00:00» y se
// comprueba que ninguna fecha sale NaN.
const arreglaHuso = (s) => String(s).trim().replace(/([+-]\d{2})$/, '$1:00')
const pedidos = fs.readFileSync(path.join(DIR, 'pedidos.txt'), 'utf8')
  .split('\n').filter((l) => l.trim())
  .map((l) => {
    const [tel, fecha] = l.split('|')
    return { tel: tel.trim(), t: Date.parse(arreglaHuso(fecha)) }
  })

const malas = pedidos.filter((p) => Number.isNaN(p.t)).length
if (malas) { console.error('FECHAS ILEGIBLES en pedidos.txt: ' + malas + '. Aborto.'); process.exit(1) }

// ── Quién acabó teniendo pedido, y cuándo ────────────────────────────────
//
// SE EMPAREJA POR LOS ULTIMOS 10 DIGITOS, no por la cadena entera.
// `pedidos.telefono` y `conversaciones.cliente_id` NO siempre coinciden: el
// mismo cliente aparece como 5215534882572 en `mensajes` y de otra forma en
// `pedidos`. Comparando cadenas completas, 8 de los 10 «pedidos perdidos»
// que dio la primera version tenian su pedido registrado. Un mexicano son
// 10 digitos detras del 52/521, asi que la cola de 10 es la identidad util.
const cola = (t) => String(t || '').replace(/\D/g, '').slice(-10)

const idACliente = new Map(convs.map((c) => [c.id, c.cliente_id]))

// Se guarda el pedido MAS RECIENTE de cada cliente, no el mas antiguo.
//
// La primera version guardaba el minimo, y eso tapaba los pedidos buenos:
// un cliente con una compra del 23/8 y otra del 28/8 se quedaba con la del
// 23, anterior a la peticion de datos del 28, y salia como «pedido perdido»
// teniendo el pedido registrado un minuto despues. Ocho de los diez
// candidatos eran eso. La pregunta que hay que contestar es «¿se registro
// ALGUN pedido a partir de que mando los datos?», y para eso vale el maximo.
const pedidoDe = new Map()   // cola de 10 digitos -> instante del ultimo pedido
function apunta(cliente, t) {
  if (!cliente || Number.isNaN(t)) return
  const k = cola(cliente)
  if (!k) return
  const y = pedidoDe.get(k)
  if (y === undefined || t > y) pedidoDe.set(k, t)
}
for (const p of pedidos) apunta(p.tel, p.t)
for (const cp of convProd) {
  if (cp.estado === 'pendiente' || cp.estado === 'validado') {
    apunta(idACliente.get(cp.conversacion_id), Date.parse(cp.creado))
  }
}
console.log('  [control] clientes con pedido localizados: ' + pedidoDe.size)
if (process.env.DEPURA) {
  console.log('  [control] pedidoDe tiene 5534882572? ' + pedidoDe.has('5534882572') +
              '  valor=' + pedidoDe.get('5534882572'))
  console.log('  [control] primeras claves: ' + [...pedidoDe.keys()].slice(0, 5).join(', '))
}

// ── La condición EXACTA del nodo «¿Pedido completo?» ─────────────────────
// Copiada del jsCode, no reescrita: si un dia cambia alli, esto miente.
const laRedDispara = (texto) => {
  const t = String(texto || '')
  return !t.includes('?') && (/\d/.test(t) || t.trim().split(/\s+/).length >= 3)
}

// Lo que de verdad parece una DIRECCION DE ENVIO.
//
// «numeros y 6+ palabras» no vale: caza «El de 12 luces pero cuanto se tarda
// en traer», que no es una direccion sino conversacion normal. Con ese
// criterio salian 110 clientes y casi ninguno habia mandado sus datos.
//
// Se exigen DOS SEÑALES de las de abajo ademas de digitos y 8+ palabras.
// Son las piezas que Maria pide explicitamente —calle, numero, entre calles,
// colonia, CP— asi que un mensaje que lleva dos de ellas es un envio, no una
// pregunta sobre el precio.
const SENALES = [
  /\bcalle\b/i, /\bcolonia\b|\bcol\.?\s/i, /\bentre\b/i,
  /\bc\.?\s?p\.?\s*\d{4,5}\b/i, /#\s*\d/, /\bav\.?\b|\bavenida\b/i,
  /\bnombre\s*:/i, /\bmunicipio\b/i, /\bn[uú]m(ero)?\.?\s*\d/i,
  /\bint(erior)?\.?\s*\d/i, /\bfracc/i, /\bmz\b|\bmanzana\b/i,
]
const pareceDireccion = (texto) => {
  const t = String(texto || '')
  if (t.includes('?')) return false
  if (!/\d/.test(t)) return false
  if (t.trim().split(/\s+/).length < 8) return false
  return SENALES.filter((r) => r.test(t)).length >= 2
}

const LITERALES = [/para preparar el env/i, /necesito estos datos/i, /datos de env/i]
const pideDatos = (m) => m.direccion === 'out' && LITERALES.some((r) => r.test(m.texto || ''))

// ── Se recorre por cliente, en orden ─────────────────────────────────────
const porCliente = new Map()
for (const m of mensajes) {
  if (!porCliente.has(m.cliente_id)) porCliente.set(m.cliente_id, [])
  porCliente.get(m.cliente_id).push(m)
}

const VENTANA = 48 * 3600 * 1000

let clientesConPeticion = 0
let contestaron = 0
let habriaDisparado = 0
let habriaDisparadoSinPedido = 0
let pareceDireccionSinPedido = 0
const perdidos = []

for (const [cliente, lista] of porCliente) {
  lista.sort((a, b) => Date.parse(a.creado) - Date.parse(b.creado))
  const peticiones = lista.filter(pideDatos)
  if (!peticiones.length) continue
  clientesConPeticion++

  // La PRIMERA vez que se le pidieron los datos
  const t0 = Date.parse(peticiones[0].creado)

  // La primera respuesta del cliente despues de esa peticion
  const respuesta = lista.find(
    (m) => m.direccion === 'in' && Date.parse(m.creado) > t0 && Date.parse(m.creado) - t0 < VENTANA,
  )
  if (!respuesta) continue
  contestaron++

  const dispara = laRedDispara(respuesta.texto)
  const direccion = pareceDireccion(respuesta.texto)
  if (dispara) habriaDisparado++

  const tPedido = pedidoDe.get(cola(cliente))
  const tienePedido = tPedido !== undefined && tPedido > t0 - 3600 * 1000

  if (dispara && !tienePedido) habriaDisparadoSinPedido++
  if (direccion && !tienePedido) {
    pareceDireccionSinPedido++
    perdidos.push({
      cliente,
      cuando: respuesta.creado.slice(0, 16).replace('T', ' '),
      palabras: String(respuesta.texto || '').trim().split(/\s+/).length,
      muestra: String(respuesta.texto || '').replace(/\s+/g, ' ').slice(0, 70),
    })
  }
}

const pct = (n, d) => d ? (100 * n / d).toFixed(1) + ' %' : '-'

console.log('')
console.log('DESDE LA MIGRACION A CLOUD API (21/8/2026 - 8/9/2026)')
console.log('')
console.log('  mensajes analizados                      ' + mensajes.length)
console.log('  pedidos registrados en el periodo        ' + pedidos.length)
console.log('')
console.log('  clientes a los que Maria pidio los datos ' + clientesConPeticion)
console.log('  ...que contestaron algo en 48 h          ' + contestaron +
            '   (' + pct(contestaron, clientesConPeticion) + ')')
console.log('')
console.log('  LA RED habria disparado en               ' + habriaDisparado +
            '   (' + pct(habriaDisparado, contestaron) + ' de los que contestaron)')
console.log('  ...y de esos, SIN pedido registrado      ' + habriaDisparadoSinPedido)
console.log('')
console.log('  CANDIDATOS A PEDIDO PERDIDO              ' + pareceDireccionSinPedido)
console.log('  (la respuesta lleva numeros y 6+ palabras, y no hay pedido)')
console.log('')

if (perdidos.length) {
  console.log('  Los ' + Math.min(perdidos.length, 15) + ' primeros, para ir a mirarlos a mano:')
  console.log('')
  for (const p of perdidos.slice(0, 15)) {
    console.log('    ' + p.cuando + '  ' + p.cliente.padEnd(14) +
                String(p.palabras).padStart(3) + ' pal.  ' + p.muestra)
  }
  console.log('')
}

// ── SEGUNDA MEDIDA, y es la que de verdad contesta a la pregunta ─────────
//
// Lo de arriba solo mira a quien recibio la peticion con uno de los TRES
// LITERALES. Pero la pregunta era otra: «cada vez que el modelo se olvida
// del marcador, ¿se cae un pedido?». Eso hay que buscarlo por el lado del
// cliente, no por el nuestro: CUALQUIER cliente que en algun momento haya
// mandado algo con pinta de direccion de envio, pidieramosela como se la
// pidieramos, y que no tenga pedido registrado despues.
//
// Es una red mucho mas ancha: no depende de como redactara Maria.
console.log('LO MISMO PERO SIN DEPENDER DE COMO LO PIDIERA MARIA')
console.log('')

let mandaronDireccion = 0
let sinPedidoDespues = 0
const huerfanos = []

for (const [cliente, lista] of porCliente) {
  const dirs = lista.filter((m) => m.direccion === 'in' && pareceDireccion(m.texto))
  if (!dirs.length) continue
  mandaronDireccion++

  // La ULTIMA vez que mando algo con pinta de direccion
  const ultima = dirs[dirs.length - 1]
  const tDir = Date.parse(ultima.creado)
  const tPedido = pedidoDe.get(cola(cliente))

  // Un pedido registrado hasta una hora ANTES ya vale: `Guardar pedido`
  // escribe casi a la vez que llega el mensaje, y a veces se adelanta.
  if (tPedido !== undefined && tPedido > tDir - 3600 * 1000) continue

  sinPedidoDespues++
  huerfanos.push({
    cliente,
    cuando: ultima.creado.slice(0, 16).replace('T', ' '),
    tienePedidoAntes: tPedido !== undefined,
    muestra: String(ultima.texto || '').replace(/\s+/g, ' ').slice(0, 70),
  })
}

console.log('  clientes que mandaron algo con pinta de direccion  ' + mandaronDireccion)
console.log('  ...sin pedido registrado a partir de ahi           ' + sinPedidoDespues +
            '   (' + pct(sinPedidoDespues, mandaronDireccion) + ')')
console.log('')

if (huerfanos.length) {
  console.log('  Todos, para revisarlos a mano:')
  console.log('')
  for (const h of huerfanos) {
    console.log('    ' + h.cuando + '  ' + h.cliente.padEnd(14) +
                (h.tienePedidoAntes ? '[pedido ANTERIOR] ' : '[sin pedido nunca] ') + h.muestra)
  }
  console.log('')
}
