#!/usr/bin/env node
/**
 * LA BANDERA DE TESTING, probada fuera de n8n.
 *
 * Se saca el codigo REAL del nodo del JSON generado y se ejecuta contra un
 * catalogo de mentira. Asi lo que se prueba es lo que se va a publicar, no
 * una copia que se puede quedar vieja.
 *
 * Lo que hay que asegurar, en orden de lo que cuesta equivocarse:
 *
 *   1. Un producto NORMAL nunca es testing. Es el caso que se puede romper:
 *      un pedido real que se va al grupo de pruebas es una venta que nadie
 *      prepara.
 *   2. La columna vacia, ausente o rara cuenta como NO. Nunca al reves.
 *   3. Se lee por NOMBRE: da igual la posicion, las mayusculas, los
 *      espacios o las tildes.
 *   4. Sin producto identificado, NO es testing.
 *   5. Un producto con "si" SI es testing.
 *
 *   node pruebas-testing-por-producto.js <workflow-generado.json>
 */
const fs = require('fs')

const ruta = process.argv[2]
if (!ruta) { console.error('uso: node pruebas-testing-por-producto.js <workflow.json>'); process.exit(1) }
const w = JSON.parse(fs.readFileSync(ruta, 'utf8'))
const codigo = w.nodes.find((n) => n.name === 'Preparar pedido').parameters.jsCode

// Se recorta el trozo de la bandera: desde el comentario de TESTING hasta la
// linea que la calcula. Es codigo puro salvo por $('Leer Catalogo').
const desde = codigo.indexOf('// ── TESTING:')
const hasta = codigo.indexOf('const es_testing = esSi(testing_crudo);')
if (desde < 0 || hasta <= desde) {
  console.error('ERROR: no encuentro el bloque de testing en Preparar pedido')
  process.exit(1)
}
const trozo = codigo.slice(desde, hasta) + 'const es_testing = esSi(testing_crudo);\nreturn { es_testing, testing_crudo };'

function ejecutar(producto_id, filas) {
  // $('Leer Catalogo').all() de mentira, con la misma forma que n8n
  const $ = () => ({ all: () => filas.map((json) => ({ json })) })
  return new Function('producto_id', '$', trozo)(producto_id, $)
}

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

const CAT = [
  { id: 'glowbrush', nombre: 'GlowBrush', TESTING: 'NO' },
  { id: 'hexagel', nombre: 'HexaGel', TESTING: 'SI' },
  { id: 'vapormax', nombre: 'VaporMax', TESTING: '' },
]

console.log('\nlo que NO se puede romper: un producto normal jamas es testing')
comprueba('glowbrush (TESTING=NO)', ejecutar('glowbrush', CAT).es_testing === false)
comprueba('vapormax (TESTING vacia)', ejecutar('vapormax', CAT).es_testing === false)
comprueba('un id que no esta en el catalogo', ejecutar('fantasma', CAT).es_testing === false)
comprueba('sin producto identificado (null)', ejecutar(null, CAT).es_testing === false)
comprueba('catalogo vacio', ejecutar('hexagel', []).es_testing === false)
comprueba('SIN columna TESTING en el Sheet',
  ejecutar('hexagel', [{ id: 'hexagel', nombre: 'HexaGel' }]).es_testing === false)

console.log('\nel que si: solo "si" cuenta')
comprueba('hexagel (TESTING=SI)', ejecutar('hexagel', CAT).es_testing === true)
for (const v of ['si', 'Si', 'sI', ' SI ', 'sí', 'SÍ', 'Sí ']) {
  comprueba('«' + v + '» cuenta como si',
    ejecutar('x', [{ id: 'x', TESTING: v }]).es_testing === true)
}

console.log('\ny lo que NO cuenta, aunque lo parezca')
for (const v of ['', ' ', 'no', 'NO', 'yes', 'true', '1', 'S', 'sii', 'si no', null, undefined, 0]) {
  comprueba('«' + String(v) + '» NO cuenta',
    ejecutar('x', [{ id: 'x', TESTING: v }]).es_testing === false,
    'devolvio ' + ejecutar('x', [{ id: 'x', TESTING: v }]).es_testing)
}

console.log('\nse lee por NOMBRE, no por posicion')
comprueba('columna en minusculas', ejecutar('x', [{ id: 'x', testing: 'si' }]).es_testing === true)
comprueba('con espacio detras', ejecutar('x', [{ id: 'x', 'TESTING ': 'si' }]).es_testing === true)
comprueba('con espacio delante', ejecutar('x', [{ id: 'x', ' Testing': 'si' }]).es_testing === true)
comprueba('«Testing en pruebas» NO es la columna',
  ejecutar('x', [{ id: 'x', 'Testing en pruebas': 'si' }]).es_testing === false,
  'solo casa el nombre exacto normalizado')
comprueba('da igual donde este (ultima columna)',
  ejecutar('x', [{ id: 'x', a: 1, b: 2, c: 3, TESTING: 'si' }]).es_testing === true)

console.log('\nse ve QUE traia la columna, no solo la decision')
comprueba('testing_crudo devuelve el valor', ejecutar('hexagel', CAT).testing_crudo === 'SI')
comprueba('y null cuando no hay columna',
  ejecutar('hexagel', [{ id: 'hexagel' }]).testing_crudo === null)

console.log(fallos ? '\n' + fallos + ' FALLOS\n' : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
