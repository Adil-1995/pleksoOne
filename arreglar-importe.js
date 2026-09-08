#!/usr/bin/env node
/**
 * EL IMPORTE QUE SE LE MANDA A META.
 *
 * EL FALLO
 *   `Construir evento` hacia `valor += precio * cantidad`. Pero:
 *     - `conversacion_productos.precio`  = el precio del CATALOGO (995)
 *     - `conversacion_productos.cantidad`= las UNIDADES del pack (12 o 24)
 *   Multiplicar eso no significa nada. Medido el 8/9/2026: de los 120
 *   Purchase enviados, 43 salieron inflados —30 a $11.940 y 13 a $23.880—
 *   cuando valian $995 y $1.600. Meta recibio $668.640 por ventas de $50.650.
 *
 * DONDE ESTABA MAL: EN LOS DOS SITIOS
 *   `pedidos` lo tiene BIEN: (cantidad 12, precio 995) y (cantidad 24,
 *   precio 1600). Ahi `precio` es el IMPORTE de la linea y `cantidad` es
 *   informativa. `conversacion_productos` guardaba en `precio` el precio
 *   base del catalogo, que para el pack de 24 no es lo que paga el cliente.
 *
 *   Y el catalogo NO puede arreglarlo solo: comprobado contra el Sheet vivo,
 *   tiene UNA columna `precio` por producto (995) y el precio del pack de 24
 *   solo existe en el texto de la oferta. No hay de donde sacarlo de forma
 *   determinista.
 *
 * EL ARREGLO, en las dos mitades:
 *   1. ORIGEN — «Marcar pedido pendiente» guarda en `precio` el MISMO
 *      importe que va a `pedidos`: el que el cliente aceptó. Asi las dos
 *      tablas dicen lo mismo campo por campo.
 *   2. CALCULO — «Construir evento» SUMA los precios en vez de
 *      multiplicarlos, porque `precio` ya es el importe de la linea.
 *
 *   Las dos, porque las dos estaban mal. Arreglar solo el origen dejaria al
 *   CAPI multiplicando 1600 x 24; arreglar solo el calculo dejaria mandando
 *   995 por un pedido de 1600.
 *
 * LA GUARDA DEL CATALOGO NO SE TOCA. `precio_catalogo` sigue decidiendo si
 * el producto existe: sin producto en el catalogo no hay precio y no sale
 * evento. Lo que cambia es el IMPORTE que se guarda, no el permiso. Y si el
 * importe aceptado no es un numero, se cae al precio del catalogo, que es
 * exacto para los pedidos de una unidad —la mayoria— y nunca infla.
 *
 *   node arreglar-importe.js <receptor-vivo.json> <capi-vivo.json> <sal-rec> <sal-capi>
 */
const fs = require('fs')

const [, , fRec, fCapi, salRec, salCapi] = process.argv
if (!fRec || !fCapi || !salRec || !salCapi) {
  console.error('uso: node arreglar-importe.js <rec.json> <capi.json> <salRec.json> <salCapi.json>')
  process.exit(1)
}

const limpiar = (wf) => {
  const o = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} }
  if (wf.staticData) o.staticData = wf.staticData
  return o
}

// ── 1. EL ORIGEN ─────────────────────────────────────────────────────────
const rec = JSON.parse(fs.readFileSync(fRec, 'utf8'))
const marcar = rec.nodes.find((x) => x.name === 'Marcar pedido pendiente')
if (!marcar) { console.error('Falta «Marcar pedido pendiente». Aborto.'); process.exit(1) }

const VIEJO_BODY = marcar.parameters.jsonBody
if (!VIEJO_BODY.includes('precio: $(\'Preparar pedido\').first().json.precio_catalogo')) {
  console.error('El body de «Marcar pedido pendiente» no es el que esperaba:')
  console.error(VIEJO_BODY)
  process.exit(1)
}

// `precio` pasa a ser el IMPORTE aceptado, con el catalogo de red por si el
// modelo no dijo cifra. `cantidad` no cambia: sigue siendo informativa y
// sigue cuadrando con pedidos.cantidad.
const NUEVO_BODY =
  "={{ JSON.stringify({ conversacion_id: $('Interpretar estado').first().json.conversacion_id," +
  " producto: $('Preparar pedido').first().json.producto_id, estado: 'pendiente'," +
  " precio: Number($('Preparar pedido').first().json.precio) > 0" +
  " ? Number($('Preparar pedido').first().json.precio)" +
  " : $('Preparar pedido').first().json.precio_catalogo," +
  " cantidad: $('Preparar pedido').first().json.cantidad_num }) }}"

marcar.parameters.jsonBody = NUEVO_BODY

// ── 2. EL CALCULO ────────────────────────────────────────────────────────
const capi = JSON.parse(fs.readFileSync(fCapi, 'utf8'))
const evento = capi.nodes.find((x) => x.name === 'Construir evento')
if (!evento) { console.error('Falta «Construir evento». Aborto.'); process.exit(1) }

const VIEJO_CALC = `  const cant = parseInt(l.cantidad, 10) || 1;
  valor += parseFloat(l.precio) * cant;
  unidades += cant;`

const NUEVO_CALC = `  const cant = parseInt(l.cantidad, 10) || 1;
  // SE SUMA, NO SE MULTIPLICA. \`precio\` es el IMPORTE de la linea -lo que
  // paga el cliente, el mismo numero que hay en pedidos.precio-, y
  // \`cantidad\` son las unidades que lleva el pack, informativas.
  // Multiplicarlas mandaba a Meta 995 x 24 = $23.880 por un pedido de
  // $1.600. Las unidades siguen yendo aparte, en num_items, que es donde
  // Meta las espera.
  valor += parseFloat(l.precio);
  unidades += cant;`

if (!evento.parameters.jsCode.includes(VIEJO_CALC)) {
  console.error('El calculo de «Construir evento» no es el que esperaba. Aborto.')
  const i = evento.parameters.jsCode.indexOf('valor +=')
  console.error(evento.parameters.jsCode.slice(i - 200, i + 120))
  process.exit(1)
}
evento.parameters.jsCode = evento.parameters.jsCode.replace(VIEJO_CALC, NUEVO_CALC)

// ── Salida ───────────────────────────────────────────────────────────────
const recL = limpiar(rec), capiL = limpiar(capi)
fs.writeFileSync(salRec, JSON.stringify(recL, null, 2) + '\n', 'utf8')
fs.writeFileSync(salCapi, JSON.stringify(capiL, null, 2) + '\n', 'utf8')

const tRec = JSON.stringify(recL), tCapi = JSON.stringify(capiL)
console.log('RECEPTOR: ' + salRec)
console.log('  nodos: ' + recL.nodes.length)
console.log('  guarda el importe aceptado: ' +
  (tRec.includes("Number($('Preparar pedido').first().json.precio) > 0") ? 'sí' : 'NO — PARA'))
console.log('  la red del catalogo sigue: ' +
  (tRec.includes('precio_catalogo') ? 'sí' : 'NO — PARA'))
console.log('CAPI: ' + salCapi)
console.log('  nodos: ' + capiL.nodes.length)
console.log('  ya no multiplica: ' +
  (!tCapi.includes('parseFloat(l.precio) * cant') ? 'sí' : 'NO — PARA'))
console.log('  num_items sigue contando unidades: ' +
  (tCapi.includes('unidades += cant') ? 'sí' : 'NO — PARA'))

// Lo de hoy tiene que seguir dentro en los dos.
const guardas = [
  ['receptor: contexto solo-referral', tRec, 'SOLO el referral del anuncio'],
  ['receptor: marca de escalado', tRec, 'Marcar escalada'],
  ['receptor: pausa al escalar', tRec, 'bot_activo=is.true'],
  ['receptor: etiqueta Incidencia', tRec, 'nombre=eq.Incidencia'],
  ['capi: venta a mano', tCapi, 'Preparar venta a mano'],
]
let mal = false
for (const [que, texto, aguja] of guardas) {
  const ok = texto.includes(aguja)
  console.log('  sigue dentro: ' + que + ' -> ' + (ok ? 'sí' : 'NO — PARA'))
  if (!ok) mal = true
}
if (tRec.includes('¿Esperando datos?')) { console.log('  ¿Esperando datos? ha vuelto — PARA'); mal = true }
if (mal) process.exit(1)
