#!/usr/bin/env node
/**
 * EL RELLENO DE PRECIOS PONIA EL MISMO EN TODAS LAS LINEAS.
 *
 * EL FALLO
 *   `Preparar venta a mano` calculaba:
 *       precio_unitario: precioDe(lineas[0].producto)
 *   o sea el precio de la PRIMERA linea. Y `Rellenar precio y cantidad`
 *   hacia UN solo PATCH a `id=in.(todas)` con ese unico precio. Con dos
 *   productos distintos en la misma conversacion, los dos acababan con el
 *   precio del primero.
 *
 *   No es cosmetico: `Construir evento` SUMA `conversacion_productos.precio`
 *   para el `value` del Purchase. Una venta de HexaGel (995) + VaporMax
 *   (1200) = 2195 se le reportaria a Meta como 2400. Es la misma familia
 *   que el precio x cantidad que ya nos costo 47 Purchase inflados, con
 *   otra cara.
 *
 * CUANTO HA COSTADO HASTA HOY: CERO. Medido el 8/9/2026 contra la base: 162
 *   lineas validadas repartidas en 162 conversaciones, o sea NINGUNA
 *   conversacion tiene dos lineas validadas. El fallo nunca ha llegado a
 *   dispararse.
 *
 * PERO ESTA CARGADO: hay 19 conversaciones con dos o mas productos
 *   distintos, y el carrito del inbox valida TODOS los productos de la
 *   conversacion de una vez. Cualquiera de esas esta a un doble clic.
 *
 * EL ARREGLO: una fila por linea, con SU precio.
 *   1. `Preparar venta a mano` devuelve `lineas_precio` —un {id, precio,
 *      cantidad} por linea— en vez de un `precio_unitario` suelto. El campo
 *      viejo se QUITA: un dato que esta mal es peor que uno que no esta.
 *   2. Un nodo nuevo lo abre en un item por linea.
 *   3. `Rellenar precio y cantidad` pasa a `id=eq.{{ $json.id }}` con el
 *      precio de ESE item.
 *   4. Y otro nodo vuelve a UNA sola fila antes de seguir.
 *
 * EL PASO 4 NO ES ADORNO. Detras va «Avisar venta a mano» y detras de ese
 * «Tomar el cerrojo», que es la entrada del CAPI. Si salieran N items, se
 * mandarian N avisos a Telegram y se ejecutaria el CAPI N veces sobre la
 * misma venta. Al abrir en varios items hay que volver a cerrar, siempre.
 *
 *   node arreglar-precio-por-linea.js <entrada.json> <salida.json>
 */
const fs = require('fs')

const [entrada, salida] = process.argv.slice(2)
if (!entrada || !salida) {
  console.error('uso: node arreglar-precio-por-linea.js <entrada.json> <salida.json>')
  process.exit(1)
}
const w = JSON.parse(fs.readFileSync(entrada, 'utf8'))
if (w.id !== 'qXCipdF2Blm0v6HI') {
  console.error('ERROR: esto es ' + w.id + ', no el workflow de validacion')
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
    console.error('ERROR: el ancla aparece ' + n + ' veces en ' + donde + ': ' + aguja.slice(0, 60))
    process.exit(1)
  }
}

const ABRIR = 'Una fila por línea'
const CERRAR = 'Volver a una sola fila'
let tocados = 0

// ── 1. `Preparar venta a mano` da el precio DE CADA LINEA ─────────────────
{
  const n = nodo('Preparar venta a mano')
  let c = n.parameters.jsCode
  if (/lineas_precio/.test(c)) {
    console.log('  = «Preparar venta a mano» ya daba lineas_precio')
  } else {
    const aguja = "  precio_unitario: lineas.length ? precioDe(lineas[0].producto) : null,"
    unaVez(c, aguja, 'Preparar venta a mano')
    c = c.replace(aguja, [
      '  // UN PRECIO POR LÍNEA, no uno para todas. Antes aquí iba',
      '  // `precio_unitario: precioDe(lineas[0].producto)` —el precio de la',
      '  // PRIMERA línea— y se escribía en todas de un solo PATCH: con dos',
      '  // productos distintos, los dos acababan con el precio del primero.',
      '  // Y `Construir evento` SUMA estos precios para el `value` que se le',
      '  // manda a Meta, así que era un importe falso camino del CAPI.',
      '  lineas_precio: lineas.map(function (l) {',
      '    return { id: l.id, precio: precioDe(l.producto), cantidad: CANTIDAD_POR_DEFECTO };',
      '  }),',
    ].join('\n'))
    n.parameters.jsCode = c
    tocados++
    console.log('  + «Preparar venta a mano»: lineas_precio (y fuera precio_unitario)')
  }
}

// ── 2 y 4. Los dos nodos: abrir y volver a cerrar ─────────────────────────
const apuntar = nodo('Apuntar venta a mano')
if (!w.nodes.some((n) => n.name === ABRIR)) {
  w.nodes.push({
    parameters: {
      jsCode: [
        '// Un item por línea, para que el PATCH de al lado pueda escribir el',
        '// precio de CADA una. Sale de `lineas_precio`, que ya lo calculó',
        '// «Preparar venta a mano» contra el catálogo.',
        "const ls = $('Preparar venta a mano').first().json.lineas_precio || [];",
        '',
        '// Sin líneas no se abre nada: un array vacío aquí dejaría al nodo',
        '// siguiente sin ejecutar y la rama moriría en silencio, que es',
        '// justo el fallo del 22 de agosto. Se prefiere reventar.',
        'if (!ls.length) {',
        "  throw new Error('Venta a mano: no hay líneas que rellenar, y aquí siempre tiene que haberlas');",
        '}',
        'return ls.map(function (l) { return { json: l }; });',
      ].join('\n'),
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [apuntar.position[0] + 120, apuntar.position[1] + 120],
    id: 'venta-mano-abrir',
    name: ABRIR,
  })
  tocados++
  console.log('  + nodo «' + ABRIR + '»')
}
if (!w.nodes.some((n) => n.name === CERRAR)) {
  w.nodes.push({
    parameters: {
      jsCode: [
        '// VUELTA A UNA SOLA FILA, y no es adorno.',
        '//',
        '// Detrás va «Avisar venta a mano» y detrás de ese «Tomar el cerrojo»,',
        '// que es la entrada del CAPI. Con N items saldrían N avisos a Telegram',
        '// y el CAPI se ejecutaría N veces sobre la MISMA venta. Al abrir en',
        '// varios items hay que volver a cerrar, siempre.',
        '//',
        '// Se devuelve además cuántas líneas se rellenaron, para poder verlo en',
        '// la ejecución sin abrir la base.',
        'return [{ json: { lineas_rellenadas: $input.all().length } }];',
      ].join('\n'),
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [apuntar.position[0] + 360, apuntar.position[1] + 120],
    id: 'venta-mano-cerrar',
    name: CERRAR,
  })
  tocados++
  console.log('  + nodo «' + CERRAR + '»')
}

// ── 3. El PATCH, por línea ────────────────────────────────────────────────
{
  const n = nodo('Rellenar precio y cantidad')
  if (/id=eq\./.test(n.parameters.url)) {
    console.log('  = el PATCH ya iba por línea')
  } else {
    unaVez(n.parameters.url, 'id=in.(', 'Rellenar precio y cantidad (url)')
    n.parameters.url = '={{ $env.SUPABASE_URL }}/rest/v1/conversacion_productos?id=eq.{{ $json.id }}'
    n.parameters.jsonBody = '={{ JSON.stringify({ precio: $json.precio, cantidad: $json.cantidad }) }}'
    tocados++
    console.log('  + «Rellenar precio y cantidad»: un PATCH por línea, con SU precio')
  }
}

// ── Cableado ──────────────────────────────────────────────────────────────
{
  const esperadoApuntar = JSON.stringify({ main: [[{ node: 'Rellenar precio y cantidad', type: 'main', index: 0 }]] })
  const esperadoRellenar = JSON.stringify({ main: [[{ node: 'Avisar venta a mano', type: 'main', index: 0 }]] })
  if (JSON.stringify(w.connections['Apuntar venta a mano']) === esperadoApuntar) {
    w.connections['Apuntar venta a mano'] = { main: [[{ node: ABRIR, type: 'main', index: 0 }]] }
    w.connections[ABRIR] = { main: [[{ node: 'Rellenar precio y cantidad', type: 'main', index: 0 }]] }
    w.connections['Rellenar precio y cantidad'] = { main: [[{ node: CERRAR, type: 'main', index: 0 }]] }
    w.connections[CERRAR] = { main: [[{ node: 'Avisar venta a mano', type: 'main', index: 0 }]] }
    tocados++
    console.log('  + cableado: Apuntar -> ' + ABRIR + ' -> Rellenar -> ' + CERRAR + ' -> Avisar')
  } else if (JSON.stringify(w.connections['Apuntar venta a mano']).includes(ABRIR)) {
    console.log('  = el cableado ya pasaba por los dos nodos')
  } else {
    console.error('ERROR: el cableado de «Apuntar venta a mano» no es el esperado:')
    console.error('  ' + JSON.stringify(w.connections['Apuntar venta a mano']))
    process.exit(1)
  }
  if (JSON.stringify(w.connections['Rellenar precio y cantidad']) === esperadoRellenar) {
    console.error('ERROR: «Rellenar» sigue saliendo directo a «Avisar»; se multiplicarían los avisos')
    process.exit(1)
  }
}

const fuera = { name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} }
fs.writeFileSync(salida, JSON.stringify(fuera, null, 2), 'utf8')
console.log('\ncambios: ' + tocados + '  ->  ' + salida)
