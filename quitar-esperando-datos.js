#!/usr/bin/env node
/**
 * Fuera «¿Esperando datos?», que lleva roto desde la migración a Cloud API.
 *
 * QUÉ HACÍA
 *   Un nodo Postgres que contaba si el ÚLTIMO mensaje del agente pedía los
 *   datos de envío, consultando n8n_chat_histories con
 *   session_id = 'lumabot-' + numero_cliente.
 *
 * POR QUÉ ESTÁ MUERTO
 *   En esa tabla hay 9333 filas y TODAS empiezan por 'rosy-'. Con el prefijo
 *   'lumabot-': cero. Asi que `esperando` vale 0 siempre, y ha valido 0
 *   siempre. Encima, desde que b29929f quitó el nodo de memoria del agente,
 *   la tabla ya ni recibe filas nuevas: arreglar el prefijo tampoco serviría.
 *
 * QUÉ SE PIERDE
 *   Nada que estuviera funcionando. Era la segunda mitad de un OR en
 *   «¿Pedido completo?»:
 *
 *     output.includes('[PEDIDO]')                      <- esto sí funciona
 *     || ( esperando > 0 && !texto.includes('?')
 *          && (/\d/.test(texto) || palabras >= 3) )    <- esto nunca fue cierto
 *
 *   Medido sobre los 16205 mensajes del 21/8 al 8/9: de los 218 clientes que
 *   contestaron a la petición de datos, TODOS los que mandaron una dirección
 *   de verdad tienen su pedido registrado. La red no ha cazado nada porque no
 *   ha hecho falta que cazara nada.
 *
 * POR QUÉ SE QUITA EN VEZ DE ARREGLARSE
 *   Porque da falsa sensación de red. Mientras esté ahí, cualquiera que lea
 *   el flujo dará por hecho que existe una segunda vía por si el modelo se
 *   olvida del marcador, y no existe. Un nodo que aparenta proteger y no
 *   protege es peor que no tenerlo: es exactamente la alarma de incendios
 *   apagada del 22 de agosto.
 *
 *   La fuga real está en otro sitio —el pedido que toma un humano desde el
 *   inbox y no queda registrado en ninguna parte— y esa va en su tanda.
 *
 *   node quitar-esperando-datos.js <vivo.json> <salida.json>
 */
const fs = require('fs')

const [, , origen, destino] = process.argv
if (!origen || !destino) {
  console.error('uso: node quitar-esperando-datos.js <vivo.json> <salida.json>')
  process.exit(1)
}

const wf = JSON.parse(fs.readFileSync(origen, 'utf8'))

const MUERTO = '¿Esperando datos?'
const ANTES = 'Juntar mensajes'
const DESPUES = 'Leer conversación'
const LECTOR = '¿Pedido completo?'

for (const n of [MUERTO, ANTES, DESPUES, LECTOR]) {
  if (!wf.nodes.some((x) => x.name === n)) {
    console.error('Falta el nodo «' + n + '». Aborto.')
    process.exit(1)
  }
}

// Nadie más que «¿Pedido completo?» puede referenciarlo. Si aparece otro,
// hay que mirarlo a mano antes de borrar nada.
const lectores = wf.nodes.filter((n) =>
  n.name !== MUERTO && JSON.stringify(n.parameters || {}).includes(MUERTO))
if (lectores.length !== 1 || lectores[0].name !== LECTOR) {
  console.error('Lo referencian: ' + lectores.map((n) => n.name).join(', ') + '. Esperaba solo «' + LECTOR + '». Aborto.')
  process.exit(1)
}

// ── 1. La condición de «¿Pedido completo?» se queda solo con el marcador ──
const nodo = wf.nodes.find((x) => x.name === LECTOR)
const cond = nodo.parameters.conditions.conditions[0]
const VIEJA = cond.leftValue

if (!VIEJA.includes(MUERTO) || !VIEJA.includes('[PEDIDO]')) {
  console.error('La condición de «' + LECTOR + '» no es la que esperaba. Aborto.')
  process.exit(1)
}

cond.leftValue = "={{ String($('AI Agent').item.json.output || '').includes('[PEDIDO]') }}"

// ── 2. Fuera el nodo, y se cose el hueco ─────────────────────────────────
wf.nodes = wf.nodes.filter((n) => n.name !== MUERTO)
delete wf.connections[MUERTO]

const salida = wf.connections[ANTES].main[0]
const i = salida.findIndex((c) => c.node === MUERTO)
if (i < 0) { console.error('«' + ANTES + '» no apuntaba a «' + MUERTO + '». Aborto.'); process.exit(1) }
salida[i] = { node: DESPUES, type: 'main', index: 0 }

// ── 3. Payload limpio para el PUT ────────────────────────────────────────
const limpio = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
}
if (wf.staticData) limpio.staticData = wf.staticData

const texto = JSON.stringify(limpio)
fs.writeFileSync(destino, JSON.stringify(limpio, null, 2) + '\n', 'utf8')

console.log('Escrito: ' + destino)
console.log('  nodos:            ' + wf.nodes.length + ' (antes ' + (wf.nodes.length + 1) + ')')
console.log('  ' + ANTES + ' -> ' + salida.map((c) => c.node).join(', '))
console.log('  condición nueva:  ' + cond.leftValue)
console.log('  referencias vivas a «' + MUERTO + '»: ' + (texto.includes(MUERTO) ? 'SÍ — MAL' : 'no'))

// Las dos tandas anteriores tienen que seguir dentro. Si no, la entrada era
// un espejo viejo y subir esto las desharía.
const guardas = [
  ['contexto solo-referral', 'SOLO el referral del anuncio'],
  ['marca de escalado', 'Marcar escalada'],
]
let mal = texto.includes(MUERTO)
for (const [que, aguja] of guardas) {
  const ok = texto.includes(aguja)
  console.log('  sigue dentro: ' + que + ' -> ' + (ok ? 'sí' : 'NO — PARA'))
  if (!ok) mal = true
}
if (mal) process.exit(1)
