#!/usr/bin/env node
/**
 * El [CONTEXTO] pasa a salir SOLO del referral del anuncio.
 *
 * QUÉ ESTABA MAL
 *   `Leer contexto crudo` consultaba el ÚLTIMO MENSAJE SALIENTE del cliente
 *   y `Añadir contexto` lo inyectaba como «este cliente llega desde este
 *   anuncio o saludo». O sea, se le decía a María que el cliente venía de un
 *   anuncio que era una frase suya de hace diez minutos.
 *
 *   Medido el 8/9/2026: 3838 de 4014 conversaciones (95,6 %) tienen al menos
 *   un mensaje saliente, así que a casi todas se les inyectaba esto.
 *
 *   Y peor: ese valor GANABA sobre el anuncio de verdad. El referral del
 *   webhook solo se miraba `if (!contexto)`, de modo que justo al cliente
 *   que SÍ llega de un anuncio se le tapaba el anuncio.
 *
 * QUÉ SE HACE
 *   1. El bloque CONTEXTO de `Añadir contexto` usa solo `base.contexto_anuncio`.
 *      Sin referral, no hay línea de contexto.
 *   2. Se BORRAN `Leer contexto crudo` y `Leer contexto`, y `Juntar mensajes`
 *      pasa a enganchar directamente con `¿Esperando datos?`.
 *
 *      Se borran y no se dejan colgando porque, si no, cada turno seguiría
 *      pagando una consulta a Supabase cuyo resultado no lee nadie. Un nodo
 *      así es además una trampa: el siguiente que lo vea creerá que hace algo.
 *
 * POR QUÉ NO SE PIERDE NADA
 *   El último saliente ya viaja en el bloque [HISTORIAL] desde b29929f, y ahí
 *   va con su marca correcta ([TÚ] o [COMPAÑERO]) en vez de disfrazado de
 *   anuncio. Esta línea era, además de falsa, redundante.
 *
 * Entrada:  el JSON del workflow VIVO (bajado con la API, no el del repo)
 * Salida:   el JSON a subir con PUT
 *
 * NO toca n8n. Solo escribe un fichero.
 */
const fs = require('fs')

const [, , origen, destino] = process.argv
if (!origen || !destino) {
  console.error('uso: node anadir-contexto-solo-referral.js <vivo.json> <salida.json>')
  process.exit(1)
}

const wf = JSON.parse(fs.readFileSync(origen, 'utf8'))

const A_BORRAR = ['Leer contexto crudo', 'Leer contexto']
const NUDO = 'Añadir contexto'
const ANTES = 'Juntar mensajes'
const DESPUES = '¿Esperando datos?'

// ── Guardas. Si el receptor ha cambiado de forma, esto tiene que fallar
//    AQUÍ y no en producción con un cliente delante. ───────────────────────
const falta = [...A_BORRAR, NUDO, ANTES, DESPUES].filter(
  (n) => !wf.nodes.some((x) => x.name === n),
)
if (falta.length) {
  console.error('Faltan nodos: ' + falta.join(', ') + '. Aborto.')
  process.exit(1)
}

// Nadie más puede referenciar los nodos que se van. Es el fallo nº1 del
// 22 de agosto: un nodo que apunta por nombre a otro que en su rama no se
// ha ejecutado devuelve un objeto de error que se traga el `onError`.
for (const n of wf.nodes) {
  if (A_BORRAR.includes(n.name) || n.name === NUDO) continue
  const s = JSON.stringify(n.parameters || {})
  for (const muerto of A_BORRAR) {
    if (s.includes("'" + muerto + "'") || s.includes('"' + muerto + '"')) {
      console.error('«' + n.name + '» referencia a «' + muerto + '», que se borra. Aborto.')
      process.exit(1)
    }
  }
}

// ── 1. El bloque CONTEXTO ────────────────────────────────────────────────
const nudo = wf.nodes.find((x) => x.name === NUDO)
const viejo = nudo.parameters.jsCode

const BLOQUE_VIEJO = `// ---------- CONTEXTO ----------
let contexto = '';
let origen = 'ninguno';

try {
  const fila = $('Leer contexto').first().json;
  if (fila && fila.texto) { contexto = String(fila.texto); origen = 'saludo automatico'; }
} catch (e) {}

if (!contexto && base.contexto_anuncio) {
  contexto = base.contexto_anuncio;
  origen = base.origen_contexto || 'webhook';
}

// El contexto también se sanea: viene de un mensaje, no de nosotros
contexto = sanear(contexto).replace(/\\s+/g, ' ').slice(0, 300);`

const BLOQUE_NUEVO = `// ---------- CONTEXTO ----------
// SOLO el referral del anuncio, y si no lo hay, NO hay línea de contexto.
//
// Antes esto leía el último mensaje SALIENTE del cliente (nodos «Leer
// contexto crudo» y «Leer contexto», ya borrados) y se lo presentaba a
// María como el anuncio del que venía. O sea: se le decía que el cliente
// llegaba desde un anuncio que era una frase suya de hace diez minutos.
// Medido el 8/9/2026: le pasaba al 95,6 % de las conversaciones (3838 de
// 4014 tienen algún saliente).
//
// Y encima ganaba: el referral de verdad solo se miraba si aquello venía
// vacío, así que al cliente que SÍ llegaba de un anuncio se le tapaba su
// anuncio con una frase nuestra.
//
// No se pierde nada al quitarlo: el último saliente ya viaja en el bloque
// [HISTORIAL] de aquí arriba, y ahí va con su marca correcta ([TÚ] o
// [COMPAÑERO]) en vez de disfrazado de anuncio.
//
// OJO: el referral solo llega en el PRIMER mensaje del cliente, y si manda
// dos seguidos el buffer se come esa ejecución — la que llega aquí es la
// del segundo, sin \`referral\`. Entonces no hay contexto y no se inyecta
// nada, que es lo correcto: antes, en ese mismo caso, se inventaba uno.
// Si algún día hace falta rescatarlo, la vía es la de «Decidir ficha»:
// leerlo de \`mensajes.payload\`, donde está guardado desde el primer día.
let contexto = sanear(base.contexto_anuncio || '').replace(/\\s+/g, ' ').slice(0, 300);
let origen = contexto ? (base.origen_contexto || 'webhook') : 'ninguno';`

if (!viejo.includes(BLOQUE_VIEJO)) {
  console.error('El bloque CONTEXTO de «' + NUDO + '» no es el que esperaba. Aborto.')
  process.exit(1)
}
nudo.parameters.jsCode = viejo.replace(BLOQUE_VIEJO, BLOQUE_NUEVO)

// La cabecera del nodo también mentía: ya no hay saludo de campaña.
nudo.parameters.jsCode = nudo.parameters.jsCode.replace(
  '// el saludo automático de la campaña.',
  '// el anuncio del que viene, si es que viene de uno.',
)

// ── 2. Fuera los dos nodos, y se cose el hueco ───────────────────────────
wf.nodes = wf.nodes.filter((n) => !A_BORRAR.includes(n.name))
for (const muerto of A_BORRAR) delete wf.connections[muerto]

const salida = wf.connections[ANTES].main[0]
const i = salida.findIndex((c) => c.node === A_BORRAR[0])
if (i < 0) {
  console.error('«' + ANTES + '» no apuntaba a «' + A_BORRAR[0] + '». Aborto.')
  process.exit(1)
}
salida[i] = { node: DESPUES, type: 'main', index: 0 }

// ── 3. El PUT de la API pública no admite campos de solo lectura ─────────
//
// El GET devuelve 22 campos y el PUT solo acepta cuatro. Uno de los que
// sobran es `activeVersion`: una copia CONGELADA y entera de la versión
// publicada, 162 KB. Ojo con ella al comprobar cosas — cualquier búsqueda
// sobre el objeto del GET encuentra el código VIEJO ahí dentro y parece que
// el cambio no se ha aplicado. Por eso lo de abajo se comprueba sobre lo
// que de verdad se va a subir, no sobre `wf`.
const limpio = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
}
if (wf.staticData) limpio.staticData = wf.staticData

const texto = JSON.stringify(limpio, null, 2) + '\n'
fs.writeFileSync(destino, texto, 'utf8')

const vivas = texto.includes("$('Leer contexto')")

console.log('Escrito: ' + destino)
console.log('  nodos:        ' + wf.nodes.length + ' (antes ' + (wf.nodes.length + 2) + ')')
console.log('  ' + ANTES + ' -> ' + salida.map((c) => c.node).join(', '))
console.log('  claves del PUT: ' + Object.keys(limpio).join(', '))
console.log('  referencias vivas a «Leer contexto»: ' + (vivas ? 'SÍ — MAL' : 'no'))

if (vivas) process.exit(1)
