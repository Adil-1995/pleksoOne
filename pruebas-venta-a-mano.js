#!/usr/bin/env node
/**
 * El jsCode REAL de «Preparar venta a mano», contra datos REALES.
 *
 * Igual que pruebas-contexto-referral.js: el código se saca del nodo tal cual
 * está en el JSON, no se reescribe aquí. Si el nodo cambia y esto no, falla.
 *
 * Los mensajes son los de produccion (mensajes.ndjson). El catálogo se pone a
 * mano con los ids y precios que se ven en las conversaciones —el Sheet no se
 * puede leer desde aquí—, que es suficiente para lo que se prueba: la
 * DECISIÓN, no el contenido del catálogo.
 *
 *   node pruebas-venta-a-mano.js <workflow.json> <directorio-datos>
 */
const fs = require('fs')
const path = require('path')

const [, , fWf, DIR] = process.argv
const wf = JSON.parse(fs.readFileSync(fWf, 'utf8'))
const codigo = wf.nodes.find((n) => n.name === 'Preparar venta a mano').parameters.jsCode

const mensajes = JSON.parse(
  fs.readFileSync(path.join(DIR, 'mensajes.ndjson'), 'utf8').replace(/\n/g, '').replace(/\]\s*\[/g, ','))

const CATALOGO = [
  { id: 'lucessolares', nombre: 'Mini Luces LED Solares', precio: '$995' },
  { id: 'filtroagua', nombre: 'Filtro de Agua para Grifo', precio: '$995' },
  { id: 'aspiradora', nombre: 'Aspirador y Soplador', precio: '$1,200' },
  { id: 'sinprecio', nombre: 'Producto recién añadido', precio: '' },
]

function correr({ conv, yaEsta, entrantes, catalogo }) {
  const nodos = {
    'Sacar el token': { first: () => ({ json: { body: { conversacion_id: conv ? conv.id : 999 } } }) },
    'Leer venta a mano': { first: () => ({ json: { body: conv ? [conv] : [] } }) },
    'Leer catálogo de la venta': { all: () => (catalogo || CATALOGO).map((c) => ({ json: c })) },
    'Leer datos del cliente': { first: () => ({ json: { body: entrantes } }) },
    '¿Ya hay pedido?': { first: () => ({ json: { ya_esta: yaEsta ? 1 : 0 } }) },
  }
  const $ = (n) => {
    if (!nodos[n]) throw new Error("Node '" + n + "' hasn't been executed")
    return nodos[n]
  }
  // eslint-disable-next-line no-new-func
  return new Function('$', codigo)($)[0].json
}

const entrantesDe = (cliente) => mensajes
  .filter((m) => m.cliente_id === cliente && m.direccion === 'in')
  .sort((a, b) => Date.parse(b.creado) - Date.parse(a.creado))
  .map((m) => ({ texto: m.texto, creado: m.creado }))

const linea = (producto, validado) => ({
  id: 1, producto, estado: 'validado', precio: null, cantidad: null,
  validado_en: validado ? '2026-09-06T16:20:00+00:00' : null,
})

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

// ── 1. El caso real: Fernando, venta a mano sin apuntar ──────────────────
console.log('\n1. Fernando (5219993929375): venta a mano, sin fila en pedidos')
{
  const r = correr({
    conv: { id: 17116, cliente_id: '5219993929375', nombre: 'Fico',
            canales: { catalogo_hoja: null },
            conversacion_productos: [linea('lucessolares', true)] },
    yaEsta: false,
    entrantes: entrantesDe('5219993929375'),
  })
  comprueba('se apunta', r.accion === 'apuntar', 'accion=' + r.accion + ' motivo=' + r.motivo)
  comprueba('precio del catálogo, no inventado: 995', r.precio === '995', 'precio=' + r.precio)
  comprueba('cantidad por defecto 1', r.cantidad === '1', 'cantidad=' + r.cantidad)
  comprueba('encuentra SU dirección real',
    /Calle 45a n[uú]mero 998/.test(r.datos_cliente), r.datos_cliente.slice(0, 70))
  comprueba('el aviso DICE que la cantidad es suposición',
    /CANTIDAD = 1 por defecto/.test(r.aviso))
  comprueba('el aviso DICE de qué mensaje salió la dirección',
    /DATOS sacados del mensaje del cliente de las 2026-09-06/.test(r.aviso),
    (r.aviso.match(/DATOS[^\n]*/) || [''])[0])
  console.log('\n--- el aviso que llegaría a Telegram ---')
  console.log(r.aviso.split('\n').map((l) => '    ' + l).join('\n'))
  console.log('')
}

// ── 2. Alberto: el otro producto, para que no sea casualidad ─────────────
console.log('2. Alberto (5219511608468): aspiradora a $1,200')
{
  const r = correr({
    conv: { id: 20823, cliente_id: '5219511608468', nombre: 'Alberto',
            canales: { catalogo_hoja: null },
            conversacion_productos: [linea('aspiradora', true)] },
    yaEsta: false,
    entrantes: entrantesDe('5219511608468'),
  })
  comprueba('se apunta', r.accion === 'apuntar')
  comprueba('precio 1200, con la coma del Sheet quitada', r.precio === '1200', 'precio=' + r.precio)
  comprueba('coge su dirección', /16 septiembre #2/.test(r.datos_cliente), r.datos_cliente.slice(0, 60))
}

// ── 3. Lo NORMAL: la venta ya está apuntada ──────────────────────────────
console.log('\n3. Lo normal: el flujo ya apuntó el pedido (107 de 122 casos)')
{
  const r = correr({
    conv: { id: 1, cliente_id: '5219993929375', nombre: 'Fico',
            canales: { catalogo_hoja: null },
            conversacion_productos: [linea('lucessolares', true)] },
    yaEsta: true,
    entrantes: entrantesDe('5219993929375'),
  })
  comprueba('no hace nada', r.accion === 'nada', 'accion=' + r.accion)
  comprueba('y no dice nada por Telegram', r.hay_algo_que_decir === false)
}

// ── 4. Validado por el flujo, no por una persona ─────────────────────────
console.log('\n4. Línea validada SIN validado_en: no es una validación humana')
{
  const r = correr({
    conv: { id: 1, cliente_id: '5219993929375', nombre: 'Fico',
            canales: { catalogo_hoja: null },
            conversacion_productos: [linea('lucessolares', false)] },
    yaEsta: false,
    entrantes: entrantesDe('5219993929375'),
  })
  comprueba('no hace nada', r.accion === 'nada', 'accion=' + r.accion + ' motivo=' + r.motivo)
}

// ── 5. El producto no está en el catálogo ────────────────────────────────
console.log('\n5. Producto sin precio en el catálogo: se AVISA y NO se apunta')
{
  const r = correr({
    conv: { id: 1, cliente_id: '5219993929375', nombre: 'Fico',
            canales: { catalogo_hoja: null },
            conversacion_productos: [linea('sinprecio', true)] },
    yaEsta: false,
    entrantes: entrantesDe('5219993929375'),
  })
  comprueba('NO se apunta', r.se_puede_apuntar === false, 'accion=' + r.accion)
  comprueba('pero sí se avisa', r.hay_algo_que_decir === true)
  comprueba('y el aviso dice por qué', /no tiene precio para: sinprecio/.test(r.aviso),
    (r.aviso.match(/No se ha apuntado[^\n]*/) || [''])[0])
}

// ── 6. Sin dirección en la conversación ──────────────────────────────────
console.log('\n6. Cliente sin ningún mensaje que parezca dirección')
{
  const r = correr({
    conv: { id: 1, cliente_id: '5219993929375', nombre: 'Fico',
            canales: { catalogo_hoja: null },
            conversacion_productos: [linea('lucessolares', true)] },
    yaEsta: false,
    entrantes: [{ texto: 'sí me interesa', creado: '2026-09-06T10:00:00+00:00' }],
  })
  comprueba('se apunta igual: la venta es real aunque falten los datos',
    r.accion === 'apuntar')
  comprueba('y el aviso CANTA que no hay datos de envío',
    /SIN DATOS DE ENVÍO/.test(r.aviso),
    (r.aviso.match(/SIN DATOS[^\n]*/) || [''])[0])
}

// ── 7. La conversación no existe: revienta, no cuela ─────────────────────
console.log('\n7. Si no se encuentra la conversación, revienta')
{
  let revento = false
  try { correr({ conv: null, yaEsta: false, entrantes: [] }) }
  catch (e) { revento = /no encuentro la conversación/.test(e.message) }
  comprueba('revienta con el id dentro del mensaje', revento)
}

console.log(fallos ? `\n${fallos} FALLO(S)\n` : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
