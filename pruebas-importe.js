#!/usr/bin/env node
/**
 * El jsCode REAL de «Construir evento», con los datos REALES de los pedidos
 * que ya se mandaron mal. El valor que salga tiene que coincidir con
 * `pedidos.precio`, que es lo que paga el cliente.
 *
 *   node pruebas-importe.js <capi-viejo.json> <capi-nuevo.json>
 */
const fs = require('fs')

const viejo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const nuevo = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const codigoDe = (w) => w.nodes.find((n) => n.name === 'Construir evento').parameters.jsCode

/**
 * Corre el nodo con un `$()` de mentira. Solo interesa el importe, asi que
 * se le da lo justo para que llegue a calcularlo.
 */
function correr(codigo, lineas, conv) {
  const nodos = {
    '¿Tomé algo?': { first: () => ({ json: {
      conversacion_id: 42, lineas, ids: lineas.map((_, i) => i + 1),
    } }) },
    'Leer conversación y canal': { first: () => ({ json: { body: [conv] } }) },
    'Sacar el token': { first: () => ({ json: { body: { conversacion_id: 42 } } }) },
  }
  const $ = (n) => {
    if (!nodos[n]) throw new Error("Node '" + n + "' hasn't been executed")
    return nodos[n]
  }
  const $env = { CAPI_DATASET: '1', WA_API_VERSION: 'v23.0', CAPI_TOKEN: 'x' }
  // `$json` en ese punto es la salida de «Leer conversación y canal», que
  // lleva fullResponse: el cuerpo va en .body.
  const $json = { body: [conv] }
  // eslint-disable-next-line no-new-func
  return new Function('$', '$env', '$json', codigo)($, $env, $json)[0].json
}

const CONV = {
  cliente_id: '5215617359211', ctwa_clid: 'ARBxxxx', canal_id: 1,
  canales: { waba_id: '1', dataset_id: '1', nombre: 'MX' },
  conversacion_productos: [{ id: 1, validado_en: '2026-09-08T10:00:00Z' }],
}

// Los casos REALES que salieron mal, con lo que dice `pedidos` que valian.
const CASOS = [
  { que: '12 luces — pedidos dice $995',
    lineas: [{ producto: 'lucessolares', precio: 995, cantidad: 12 }], real: 995 },
  { que: '24 luces — pedidos dice $1.600',
    lineas: [{ producto: 'lucessolares', precio: 1600, cantidad: 24 }], real: 1600 },
  { que: '1 soporte — pedidos dice $995',
    lineas: [{ producto: 'soporte360', precio: 995, cantidad: 1 }], real: 995 },
  { que: '1 aspiradora — pedidos dice $1.200',
    lineas: [{ producto: 'aspiradora', precio: 1200, cantidad: 1 }], real: 1200 },
  { que: 'dos lineas: 24 luces + 1 filtro = $2.595',
    lineas: [{ producto: 'lucessolares', precio: 1600, cantidad: 24 },
             { producto: 'filtroagua', precio: 995, cantidad: 1 }], real: 2595 },
]

let fallos = 0
console.log('')
console.log('  caso                                        ANTES        AHORA      pedidos   num_items')
console.log('  ' + '-'.repeat(88))
for (const c of CASOS) {
  const a = correr(codigoDe(viejo), c.lineas, CONV)
  const b = correr(codigoDe(nuevo), c.lineas, CONV)
  const ok = b.valor === c.real
  if (!ok) fallos++
  console.log('  ' + (ok ? 'ok  ' : 'MAL ') + c.que.padEnd(40) +
    ('$' + (a.valor ?? '?')).padStart(10) +
    ('$' + (b.valor ?? '?')).padStart(11) +
    ('$' + c.real).padStart(11) +
    String(b.unidades ?? '?').padStart(9))
}

console.log('')
// Que el evento que sale lleve el valor bueno tambien por dentro
const b = correr(codigoDe(nuevo), CASOS[1].lineas, CONV)
const cd = b.evento && b.evento.data && b.evento.data[0] && b.evento.data[0].custom_data
console.log('  el evento que se manda, para el pedido de 24 luces:')
console.log('    value     = ' + (cd && cd.value) + '   (pedidos dice 1600)')
console.log('    currency  = ' + (cd && cd.currency))
console.log('    num_items = ' + (cd && cd.num_items) + '   (las 24 unidades, aparte)')
if (!cd || cd.value !== 1600) { console.log('    MAL: el value no es 1600'); fallos++ }

// La red de seguridad no se toca: sin precio, no hay evento.
const sin = correr(codigoDe(nuevo), [{ producto: 'x', precio: null, cantidad: 1 }], CONV)
console.log('')
console.log('  sin precio en la linea -> ' + (sin.puede === 'no' ? 'no sale evento (bien)' : 'MAL: sale igual'))
if (sin.puede !== 'no') fallos++

console.log(fallos ? `\n  ${fallos} FALLO(S)\n` : '\n  Todo en orden.\n')
process.exit(fallos ? 1 : 0)
