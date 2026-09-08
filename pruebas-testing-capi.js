#!/usr/bin/env node
/**
 * EL CAPI CON PRODUCTOS EN TESTING, probado fuera de n8n.
 *
 * Se saca el codigo REAL de «Construir evento» del JSON que se va a
 * publicar y se ejecuta contra entradas con la forma de verdad. Lo que se
 * prueba es lo que se publica.
 *
 * ESTO NO MANDA NADA A META. Es a proposito: un Purchase enviado no se
 * puede retirar —Meta deduplica por event_id y no tiene correccion—, asi
 * que la venta NORMAL no se puede probar contra Meta sin ensuciar los
 * datos. Se prueba aqui, y en produccion solo se prueba el caso de testing,
 * que por definicion no envia.
 *
 * Lo que hay que asegurar, de mas grave a menos:
 *
 *   1. UNA VENTA NORMAL SIGUE SALIENDO, con su importe intacto. Es lo que
 *      se puede romper: si esto falla, dejan de reportarse todas las
 *      ventas.
 *   2. Una venta de un producto en testing NO sale, y el motivo lo dice.
 *   3. Una conversacion que mezcla no sale entera (todo o nada), porque un
 *      importe parcial no es el que paga el cliente.
 *   4. La conversacion se sigue leyendo aunque delante haya un Sheets.
 *
 *   node pruebas-testing-capi.js <workflow-generado.json>
 */
const fs = require('fs')

const ruta = process.argv[2]
if (!ruta) { console.error('uso: node pruebas-testing-capi.js <workflow.json>'); process.exit(1) }
const w = JSON.parse(fs.readFileSync(ruta, 'utf8'))
const codigo = w.nodes.find((n) => n.name === 'Construir evento').parameters.jsCode

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

const CATALOGO = [
  { id: 'vapormax', nombre: 'VaporMax', precio: '1200', TESTING: 'NO' },
  { id: 'hexagel', nombre: 'HexaGel', precio: '995', TESTING: 'SI' },
  { id: 'lucessolares', nombre: 'Luces', precio: '995', TESTING: '' },
]

const AHORA = new Date().toISOString()

/** Ejecuta el nodo con los nodos de los que lee puestos delante. */
function ejecutar({ lineas, catalogo = CATALOGO, conv, env = {} }) {
  const fuentes = {
    '¿Tomé algo?': [{ json: { lineas, ids: lineas.map((l) => l.id), conversacion_id: 77 } }],
    'Leer conversación y canal': [{ json: { body: [conv] } }],
    'Leer catálogo (testing)': catalogo.map((json) => ({ json })),
  }
  const $ = (n) => {
    if (!fuentes[n]) throw new Error('el nodo pide una fuente que no existe: ' + n)
    return { first: () => fuentes[n][0], all: () => fuentes[n] }
  }
  // `$json` a propósito es una FILA DEL CATÁLOGO: es lo que entra de verdad
  // ahora que hay un Sheets delante. Si el nodo volviera a leer `$json`,
  // estas pruebas se ponen rojas.
  const $json = catalogo[0]
  return new Function('$', '$json', '$env', codigo)($, $json, env)[0].json
}

const CONV = {
  cliente_id: '5216311801910',
  ctwa_clid: 'AfgTEST',
  canales: { waba_id: '1100299049179241', dataset_id: '1623190315916336', nombre: 'Numero MX_2' },
  conversacion_productos: [
    { id: 1, validado_en: AHORA }, { id: 2, validado_en: AHORA },
  ],
}

console.log('\n1. LO QUE NO SE PUEDE ROMPER: la venta normal sigue saliendo')
{
  const r = ejecutar({ lineas: [{ id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 }], conv: CONV })
  comprueba('sale evento', r.puede === 'si', JSON.stringify(r.motivo))
  comprueba('el importe es el de la venta', r.valor === 1200, 'valor=' + r.valor)
  comprueba('con su ctwa_clid', r.evento && r.evento.data[0].user_data.ctwa_clid === 'AfgTEST')
  comprueba('y su dataset', r.dataset_id === '1623190315916336')
}
{
  const r = ejecutar({
    lineas: [
      { id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 },
      { id: 2, producto: 'lucessolares', precio: 995, cantidad: 12 },
    ], conv: CONV,
  })
  comprueba('dos productos normales: sale y se SUMAN', r.puede === 'si' && r.valor === 2195,
    'puede=' + r.puede + ' valor=' + r.valor)
  comprueba('las unidades van aparte', r.unidades === 13, 'unidades=' + r.unidades)
}

console.log('\n2. una venta de un producto en testing NO se reporta')
{
  const r = ejecutar({ lineas: [{ id: 1, producto: 'hexagel', precio: 995, cantidad: 1 }], conv: CONV })
  comprueba('no sale evento', r.puede === 'no', JSON.stringify(r))
  comprueba('el motivo nombra el producto', /testing/.test(r.motivo) && /hexagel/.test(r.motivo), r.motivo)
  comprueba('NO dice ademas «el importe sale 0»', !/importe sale 0/.test(r.motivo), r.motivo)
  comprueba('conserva el event_id, para poder revalidar en 7 dias',
    r.event_id === 'pedido-77-1', r.event_id)
}

console.log('\n3. mezcla: todo o nada, porque el importe tiene que ser el de la venta')
{
  const r = ejecutar({
    lineas: [
      { id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 },
      { id: 2, producto: 'hexagel', precio: 995, cantidad: 1 },
    ], conv: CONV,
  })
  comprueba('no sale evento', r.puede === 'no', JSON.stringify(r))
  comprueba('el motivo dice cual era', /hexagel/.test(r.motivo), r.motivo)
}

console.log('\n4. la columna vacia o ausente NO es testing')
{
  const r = ejecutar({ lineas: [{ id: 1, producto: 'lucessolares', precio: 995, cantidad: 1 }], conv: CONV })
  comprueba('TESTING vacia: sale igual', r.puede === 'si', JSON.stringify(r.motivo))
}
{
  const r = ejecutar({
    lineas: [{ id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 }],
    catalogo: [{ id: 'vapormax', nombre: 'VaporMax', precio: '1200' }], conv: CONV,
  })
  comprueba('SIN columna TESTING: sale igual', r.puede === 'si', JSON.stringify(r.motivo))
}
{
  const r = ejecutar({
    lineas: [{ id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 }],
    catalogo: [], conv: CONV,
  })
  comprueba('catálogo VACÍO: sale igual, no bloquea', r.puede === 'si', JSON.stringify(r.motivo))
}

console.log('\n5. la conversacion se lee por NOMBRE, no de $json')
{
  // Si el nodo volviera a `$json`, aquí leería una fila del catálogo: sin
  // ctwa_clid, sin waba y sin dataset. Los tres fallos a la vez.
  const r = ejecutar({ lineas: [{ id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 }], conv: CONV })
  comprueba('no se cuela el catálogo como conversación',
    !/ctwa_clid/.test(String(r.motivo || '')), r.motivo)
}
{
  const sinCtwa = JSON.parse(JSON.stringify(CONV)); sinCtwa.ctwa_clid = null
  const r = ejecutar({ lineas: [{ id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 }], conv: sinCtwa })
  comprueba('y las guardas de siempre siguen ahí', /ctwa_clid/.test(r.motivo), r.motivo)
}

console.log('\n6. lo de antes sigue igual: precio que falta y ventana de 7 dias')
{
  const r = ejecutar({ lineas: [{ id: 1, producto: 'vapormax', precio: null, cantidad: 1 }], conv: CONV })
  comprueba('sin precio no sale', r.puede === 'no' && /no tiene precio/.test(r.motivo), r.motivo)
}
{
  const viejo = JSON.parse(JSON.stringify(CONV))
  const hace10 = new Date(Date.now() - 10 * 864e5).toISOString()
  viejo.conversacion_productos = [{ id: 1, validado_en: hace10 }]
  const r = ejecutar({ lineas: [{ id: 1, producto: 'vapormax', precio: 1200, cantidad: 1 }], conv: viejo })
  comprueba('fuera de los 7 días no sale', r.puede === 'no' && /7 dias/.test(r.motivo), r.motivo)
}

console.log(fallos ? '\n' + fallos + ' FALLOS\n' : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
