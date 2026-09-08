#!/usr/bin/env node
/**
 * UN PRECIO POR LINEA, probado fuera de n8n.
 *
 * Se saca el codigo REAL de los nodos del JSON que se va a publicar. Lo que
 * se prueba es lo que se publica.
 *
 * Lo que hay que asegurar:
 *   1. Con DOS productos distintos, cada linea se lleva SU precio. Es el
 *      fallo: antes las dos se llevaban el del primero.
 *   2. Con UNO solo, sigue igual que siempre (es el 100% de lo que hay hoy
 *      en la base, asi que romperlo seria romperlo todo).
 *   3. Lo que sale del relleno vuelve a ser UNA sola fila. Si no, se
 *      mandarian N avisos a Telegram y el CAPI se ejecutaria N veces sobre
 *      la misma venta.
 *   4. Y la suma que acabaria en el `value` del Purchase es la de la venta.
 *
 *   node pruebas-precio-por-linea.js <workflow-generado.json>
 */
const fs = require('fs')

const ruta = process.argv[2]
if (!ruta) { console.error('uso: node pruebas-precio-por-linea.js <workflow.json>'); process.exit(1) }
const w = JSON.parse(fs.readFileSync(ruta, 'utf8'))
const codigoDe = (n) => {
  const x = w.nodes.find((y) => y.name === n)
  if (!x) { console.error('ERROR: falta el nodo ' + n); process.exit(1) }
  return x.parameters.jsCode
}

let fallos = 0
function comprueba(que, ok, detalle) {
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok && detalle !== undefined) console.log('        ' + detalle)
}

const CATALOGO = [
  { id: 'hexagel', nombre: 'HexaGel', precio: '995' },
  { id: 'vapormax', nombre: 'VaporMax', precio: '1200' },
  { id: 'lucessolares', nombre: 'Luces', precio: '995' },
]

/** Ejecuta «Preparar venta a mano» con sus fuentes puestas delante. */
function prepararVentaAMano(productos, { yaEsta = 0 } = {}) {
  const conv = {
    cliente_id: '5215551234567',
    nombre: 'Cliente',
    conversacion_productos: productos,
  }
  const fuentes = {
    'Leer venta a mano': [{ json: { body: [conv] } }],
    'Sacar el token': [{ json: { body: { conversacion_id: 1 } } }],
    '¿Ya hay pedido?': [{ json: { ya_esta: yaEsta } }],
    'Leer catálogo de la venta': CATALOGO.map((json) => ({ json })),
    'Leer datos del cliente': [{ json: { body: [] } }],
  }
  const $ = (n) => {
    if (!fuentes[n]) throw new Error('fuente que no existe: ' + n)
    return { first: () => fuentes[n][0], all: () => fuentes[n] }
  }
  return new Function('$', codigoDe('Preparar venta a mano'))($)[0].json
}

/** Ejecuta «Una fila por línea». */
function abrir(preparado) {
  const $ = () => ({ first: () => ({ json: preparado }) })
  return new Function('$', codigoDe('Una fila por línea'))($)
}

/** Ejecuta «Volver a una sola fila». */
function cerrar(items) {
  const $input = { all: () => items }
  return new Function('$input', codigoDe('Volver a una sola fila'))($input)
}

const AHORA = new Date().toISOString()
const linea = (id, producto) => ({ id, producto, estado: 'validado', validado_en: AHORA })

console.log('\n1. EL FALLO: dos productos distintos en la misma conversación')
{
  const p = prepararVentaAMano([linea(10, 'hexagel'), linea(11, 'vapormax')])
  comprueba('se apunta la venta', p.accion === 'apuntar', p.motivo)
  comprueba('ya no existe `precio_unitario`', p.precio_unitario === undefined,
    'sigue valiendo ' + p.precio_unitario)
  const items = abrir(p).map((i) => i.json)
  comprueba('salen DOS filas', items.length === 2, JSON.stringify(items))
  comprueba('hexagel se lleva 995',
    items.find((x) => x.id === 10).precio === 995, JSON.stringify(items))
  comprueba('vapormax se lleva 1200',
    items.find((x) => x.id === 11).precio === 1200, JSON.stringify(items))
  const suma = items.reduce((t, x) => t + x.precio, 0)
  comprueba('la suma que iría al CAPI es 2195, no 2400', suma === 2195, 'suma=' + suma)
  comprueba('y coincide con el importe de pedidos', String(suma) === p.precio,
    'pedidos=' + p.precio + ' lineas=' + suma)
}

console.log('\n2. lo que NO se puede romper: un solo producto, que es todo lo de hoy')
{
  const p = prepararVentaAMano([linea(10, 'vapormax')])
  const items = abrir(p).map((i) => i.json)
  comprueba('una sola fila', items.length === 1)
  comprueba('con su precio', items[0].precio === 1200 && items[0].id === 10, JSON.stringify(items))
  comprueba('cantidad 1, la suposición de siempre', items[0].cantidad === 1)
  comprueba('el importe de pedidos sigue igual', p.precio === '1200', p.precio)
}

console.log('\n3. se vuelve a UNA fila, o el CAPI se ejecutaría varias veces')
{
  comprueba('de 2 a 1', cerrar([{ json: {} }, { json: {} }]).length === 1)
  comprueba('de 5 a 1', cerrar([1, 2, 3, 4, 5].map(() => ({ json: {} }))).length === 1)
  comprueba('dice cuántas rellenó',
    cerrar([{ json: {} }, { json: {} }])[0].json.lineas_rellenadas === 2)
}

console.log('\n4. los casos en los que NO hay que apuntar nada siguen igual')
{
  const p = prepararVentaAMano([])
  comprueba('sin líneas validadas: nada', p.accion === 'nada' && !p.se_puede_apuntar, p.motivo)
}
{
  const p = prepararVentaAMano([linea(10, 'vapormax')], { yaEsta: 1 })
  comprueba('si ya está apuntada: nada', p.accion === 'nada', p.motivo)
}
{
  const p = prepararVentaAMano([linea(10, 'fantasma')])
  comprueba('producto sin precio de catálogo: avisa y no apunta',
    p.accion === 'avisar' && !p.se_puede_apuntar, p.motivo)
}

console.log('\n5. abrir a cero items reventaría la rama en silencio: tiene que fallar')
{
  let exploto = false
  try { abrir({ lineas_precio: [] }) } catch (e) { exploto = true }
  comprueba('sin líneas, lanza en vez de morir callado', exploto)
}

console.log(fallos ? '\n' + fallos + ' FALLOS\n' : '\nTodo en orden.\n')
process.exit(fallos ? 1 : 0)
