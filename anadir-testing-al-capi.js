#!/usr/bin/env node
/**
 * TESTING EN EL CAPI — una venta de un producto en pruebas NO se le reporta
 * a Meta.
 *
 * POR QUE NO SE MANDA
 *   Meta deduplica por `event_id` y NO tiene operacion de correccion:
 *   reenviar el mismo event_id con otro valor no arregla nada. Mandarlo es
 *   irreversible; no mandarlo es reversible durante 7 dias revalidando. Con
 *   esa asimetria, no se manda.
 *
 * TODO O NADA, y no es pereza
 *   Una conversacion con dos productos son dos lineas pero UN evento, con el
 *   `value` sumado: es lo que paga el cliente. Si se excluyera solo la linea
 *   de testing, el importe que le llega a Meta ya no seria el de la venta.
 *   Este mismo nodo ya trata asi el precio que falta —«un value incompleto
 *   es peor que un evento perdido, porque Meta optimiza con ese numero»— y
 *   aqui vale igual. Si UNA linea es de testing, no sale evento, y el motivo
 *   dice cual.
 *
 *   Ademas `Cerrar con exito` cierra TODOS los ids del cerrojo de una vez:
 *   mandar media venta obligaria a partir ese cierre, y una linea marcada
 *   como enviada sin haberse enviado es exactamente el tipo de mentira
 *   silenciosa que no se puede permitir aqui.
 *
 * DOS CAMBIOS
 *   1. Un nodo nuevo, `Leer catalogo (testing)`, entre «Leer conversacion y
 *      canal» y «Construir evento». Mismo documento, misma credencial y la
 *      misma resolucion de hoja que el catalogo de la venta a mano.
 *
 *   2. `Construir evento`:
 *      - deja de leer `$json` y lee `$('Leer conversacion y canal')` POR
 *        NOMBRE. Es obligatorio: al meter un nodo en medio, `$json` pasa a
 *        ser el catalogo y la conversacion desapareceria sin dar error.
 *      - descarta el evento si alguna linea es de un producto en testing.
 *
 * La columna se lee POR NOMBRE y solo "si" cuenta; vacia o ausente es NO,
 * igual que en el receptor. Aqui equivocarse hacia "si" solo cuesta un
 * evento que no sale y se ve en «validados sin reportar»; equivocarse hacia
 * "no" le mete a Meta una venta de pruebas que ya no se puede retirar.
 *
 *   node anadir-testing-al-capi.js <entrada.json> <salida.json>
 */
const fs = require('fs')

const [entrada, salida] = process.argv.slice(2)
if (!entrada || !salida) {
  console.error('uso: node anadir-testing-al-capi.js <entrada.json> <salida.json>')
  process.exit(1)
}
const w = JSON.parse(fs.readFileSync(entrada, 'utf8'))

if (w.id !== 'qXCipdF2Blm0v6HI') {
  console.error('ERROR: esto es ' + w.id + ', no el workflow de validacion qXCipdF2Blm0v6HI')
  process.exit(1)
}
const nodo = (n) => {
  const x = w.nodes.find((y) => y.name === n)
  if (!x) { console.error('ERROR: no existe el nodo "' + n + '"'); process.exit(1) }
  return x
}
const unaVez = (txt, aguja, donde) => {
  const n = txt.split(aguja).length - 1
  if (n !== 1) {
    console.error('ERROR: el ancla aparece ' + n + ' veces en ' + donde + ': ' + aguja.slice(0, 50))
    process.exit(1)
  }
}

const NOMBRE = 'Leer catálogo (testing)'
let tocados = 0

// ── 1. El nodo del catalogo ───────────────────────────────────────────────
if (w.nodes.some((n) => n.name === NOMBRE)) {
  console.log('  = el nodo del catálogo ya estaba')
} else {
  const modelo = nodo('Leer catálogo de la venta')
  const conv = nodo('Leer conversación y canal')
  w.nodes.push({
    parameters: {
      authentication: modelo.parameters.authentication,
      documentId: modelo.parameters.documentId,
      sheetName: {
        __rl: true,
        // Misma resolución que el catálogo de la venta a mano: la hoja del
        // canal si la tiene, y 'Productos' si no. Hoy los dos canales la
        // tienen a null —comprobado contra la tabla—, así que caen en
        // 'Productos'; si mañana alguien pone una hoja por canal, esto la
        // respeta sin tocar nada.
        value: "={{ ($('Leer conversación y canal').first().json.body[0]?.canales?.catalogo_hoja) || 'Productos' }}",
        mode: 'name',
      },
      options: {},
    },
    type: modelo.type,
    typeVersion: modelo.typeVersion,
    position: [(conv.position[0] + 110), conv.position[1] + 120],
    id: 'capi-testing-catalogo',
    name: NOMBRE,
    credentials: modelo.credentials,
  })
  tocados++
  console.log('  + nodo "' + NOMBRE + '" (mismo Sheet y misma credencial)')
}

// ── 2. Recablear: conversación -> catálogo -> construir ───────────────────
{
  const c = w.connections['Leer conversación y canal']
  const yaVa = JSON.stringify(c).includes(NOMBRE)
  if (yaVa) {
    console.log('  = el cableado ya pasaba por el catálogo')
  } else {
    const esperado = JSON.stringify({ main: [[{ node: 'Construir evento', type: 'main', index: 0 }]] })
    if (JSON.stringify(c) !== esperado) {
      console.error('ERROR: «Leer conversación y canal» no sale solo a «Construir evento»:')
      console.error('  ' + JSON.stringify(c))
      process.exit(1)
    }
    w.connections['Leer conversación y canal'] = { main: [[{ node: NOMBRE, type: 'main', index: 0 }]] }
    w.connections[NOMBRE] = { main: [[{ node: 'Construir evento', type: 'main', index: 0 }]] }
    tocados++
    console.log('  + cableado: Leer conversación y canal -> ' + NOMBRE + ' -> Construir evento')
  }
}

// ── 3. Construir evento ───────────────────────────────────────────────────
{
  const n = nodo('Construir evento')
  let c = n.parameters.jsCode

  if (/Leer catálogo \(testing\)/.test(c)) {
    console.log('  = Construir evento ya descartaba las líneas de testing')
  } else {
    // 3a. `$json` deja de valer: ahora entra el catálogo.
    const aguja = "const r = $json || {};"
    unaVez(c, aguja, 'Construir evento ($json)')
    c = c.replace(aguja, [
      '// OJO: NO se lee `$json`. Delante de este nodo hay ahora un Sheets, así',
      '// que `$json` es una FILA DEL CATÁLOGO, no la conversación. Se referencia',
      '// la fuente por nombre, que es la única forma de que meter un nodo en',
      '// medio no vacíe esto sin dar un solo error.',
      "const r = $('Leer conversación y canal').first().json || {};",
    ].join('\n'))

    // 3b. La lista de productos en pruebas y el descarte.
    const aguja2 = "let valor = 0, unidades = 0;"
    unaVez(c, aguja2, 'Construir evento (suma)')
    c = c.replace(aguja2, [
      '// ── TESTING: qué productos NO se le reportan a Meta ──────────────────',
      "// La columna se lee POR NOMBRE, misma normalización que el receptor.",
      'function claveCol(x) {',
      "  return String(x || '').toLowerCase()",
      "    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')",
      "    .trim().replace(/\\s+/g, '_');",
      '}',
      '// Solo "si" cuenta. Vacía o ausente es NO.',
      'function esSi(v) {',
      "  return String(v === null || v === undefined ? '' : v).trim().toLowerCase()",
      "    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '') === 'si';",
      '}',
      'const enPruebas = new Set();',
      "for (const item of $('Leer catálogo (testing)').all()) {",
      '  const f = item.json || {};',
      "  const pid = String(f.id || '').trim();",
      '  if (!pid) continue;',
      '  let v = null;',
      "  for (const k of Object.keys(f)) if (claveCol(k) === 'testing') { v = f[k]; break; }",
      '  if (esSi(v)) enPruebas.add(pid);',
      '}',
      '',
      'let valor = 0, unidades = 0;',
      'const enTesting = [];',
    ].join('\n'))

    // 3c. El descarte dentro del bucle, ANTES de mirar el precio: una línea
    //     de testing sin precio no tiene que ensuciar el motivo con dos cosas.
    const aguja3 = [
      'for (const l of previo.lineas) {',
      '  if (l.precio === null || l.precio === undefined) {',
    ].join('\n')
    unaVez(c, aguja3, 'Construir evento (bucle)')
    c = c.replace(aguja3, [
      'for (const l of previo.lineas) {',
      "  if (enPruebas.has(String(l.producto || '').trim())) { enTesting.push(l.producto); continue; }",
      '  if (l.precio === null || l.precio === undefined) {',
    ].join('\n'))

    // 3d. Y el veredicto: si había alguna, no sale evento.
    const aguja4 = "if (valor <= 0) fallos.push('el importe sale 0');"
    unaVez(c, aguja4, 'Construir evento (veredicto)')
    c = c.replace(aguja4, [
      '// TODO O NADA. Una conversación es UNA venta y el `value` es lo que paga',
      '// el cliente: excluir solo la línea de testing mandaría a Meta un importe',
      '// que no es el de la venta, que es justo lo que este nodo evita con el',
      '// precio que falta. Si hay una línea en pruebas, no sale evento.',
      'if (enTesting.length) {',
      "  fallos.push('producto en testing (' + enTesting.join(', ') + '): no se reporta a Meta');",
      '} else if (valor <= 0) {',
      "  fallos.push('el importe sale 0');",
      '}',
    ].join('\n'))

    n.parameters.jsCode = c
    tocados++
    console.log('  + Construir evento: lee la fuente por nombre y descarta las líneas de testing')
  }
}

const fuera = {
  name: w.name,
  nodes: w.nodes,
  connections: w.connections,
  settings: w.settings || {},
}
fs.writeFileSync(salida, JSON.stringify(fuera, null, 2), 'utf8')
console.log('\ncambios: ' + tocados + '  ->  ' + salida)
