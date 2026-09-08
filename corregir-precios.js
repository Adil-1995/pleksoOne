#!/usr/bin/env node
/**
 * Pone en `conversacion_productos.precio` el importe REAL, el que ya tiene
 * bien `pedidos`.
 *
 * POR QUE HACE FALTA ADEMAS DE ARREGLAR EL FLUJO
 *   El arreglo del flujo solo vale para lo que venga. Las filas que ya
 *   existen siguen con el precio base del catalogo (995) al lado de una
 *   cantidad de 24, y son las que se mandaran a Meta EN CUANTO ALGUIEN LAS
 *   VALIDE: los 7 pendientes de hoy y los 34 validados que aun no salieron.
 *   Sin esto, el pedido de 1.600 se reportaria como 995.
 *
 * COMO EMPAREJA
 *   Por los ULTIMOS 10 DIGITOS del telefono -`pedidos.telefono` y
 *   `conversaciones.cliente_id` no siempre se escriben igual- y por la
 *   CANTIDAD, que es la que distingue el pack de 12 del de 24. Si un cliente
 *   tiene varios pedidos, se coge el de la misma cantidad; si hay empate, el
 *   mas cercano en el tiempo a la fila.
 *
 *   Si no hay pedido que encaje, LA FILA NO SE TOCA. Prefiero dejarla como
 *   esta y que se vea, antes que inventar un importe.
 *
 *   node corregir-precios.js <directorio> [--aplicar]
 */
const fs = require('fs')
const path = require('path')

const DIR = process.argv[2]
const APLICAR = process.argv.includes('--aplicar')
if (!DIR) { console.error('uso: node corregir-precios.js <directorio> [--aplicar]'); process.exit(1) }

const cargar = (f) => JSON.parse(
  fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\n/g, '').replace(/\]\s*\[/g, ','))

const filas = cargar('cp_mal.json')
const cola = (t) => String(t || '').replace(/\D/g, '').slice(-10)

/**
 * ¿El nombre largo de `pedidos.producto` es el id de `conversacion_productos`?
 *
 * Se compara por una firma corta y EXCLUSIVA de cada producto, no por
 * palabras sueltas: «carga» sale en dos productos y emparejaria mal, que es
 * el mismo fallo que ya se corrigio en `Filtro Seguridad`.
 */
const FIRMAS = {
  lucessolares: /mini luces|luces led/i,
  soporte360:   /soporte inteligente|360/i,
  filtroagua:   /filtro/i,
  glowbrush:    /glowbrush|alisador/i,
  cojinalivia:  /coj[ií]n|alivia/i,
  aspiradora:   /aspirador|soplador/i,
  vapormax:     /vapor/i,
}
function esElMismo(idProducto, nombreLargo) {
  const r = FIRMAS[idProducto]
  if (!r) return false            // producto que no conozco: no se toca
  return r.test(String(nombreLargo || ''))
}

const arreglaHuso = (s) => String(s).trim().replace(/([+-]\d{2})$/, '$1:00')
const pedidos = fs.readFileSync(path.join(DIR, 'ped_todos.txt'), 'utf8')
  .split('\n').filter((l) => l.trim())
  .map((l) => {
    const [tel, cant, precio, fecha, producto] = l.split('|')
    return {
      cola: cola(tel),
      cantidad: parseInt(String(cant).replace(/\D/g, ''), 10) || 1,
      // «$995» y «995» conviven en la columna: fuera todo lo que no sea cifra.
      precio: parseFloat(String(precio).replace(/[^0-9.]/g, '')),
      t: Date.parse(arreglaHuso(fecha)),
      producto: producto || '',
    }
  })
  .filter((p) => !Number.isNaN(p.t) && !Number.isNaN(p.precio))

console.log('filas con cantidad > 1: ' + filas.length)
console.log('pedidos leidos: ' + pedidos.length)
console.log('')

const cambios = []
const sinPareja = []

for (const f of filas) {
  const cl = f.conversaciones && f.conversaciones.cliente_id
  const k = cola(cl)
  if (!k) continue
  const suyos = pedidos.filter((p) => p.cola === k)
  // MISMA CANTIDAD Y MISMO PRODUCTO. Nada de repliegues.
  //
  // La primera version caia a «cualquier pedido de ese cliente» cuando no
  // encontraba la cantidad, y le puso $1.600 -el pack de 24 luces- a un
  // `filtroagua` de cantidad 2. Un importe inventado es justo lo que esto
  // viene a arreglar, asi que si no encaja del todo, la fila se queda como
  // esta y sale en la lista de abajo para mirarla a mano.
  const cand = suyos.filter((p) => p.cantidad === f.cantidad && esElMismo(f.producto, p.producto))
  if (!cand.length) {
    sinPareja.push({ ...f, motivo: 'ningun pedido con ese telefono, esa cantidad y ese producto' })
    continue
  }
  // Si hay varios, el mas cercano a la fila
  const tf = Date.parse(f.capi_enviado_en || '') || 0
  cand.sort((a, b) => Math.abs(a.t - tf) - Math.abs(b.t - tf))
  const p = cand[0]
  if (Number(f.precio) === p.precio) continue          // ya esta bien
  cambios.push({
    id: f.id, cliente: cl, producto: f.producto, estado: f.estado,
    cantidad: f.cantidad, de: Number(f.precio), a: p.precio,
    yaEnviado: !!f.capi_enviado_en,
  })
}

console.log('A CORREGIR: ' + cambios.length + '   (sin pareja y sin tocar: ' + sinPareja.length + ')')
console.log('')
console.log('  id     cliente         producto      estado      cant   de      ->  a       CAPI')
console.log('  ' + '-'.repeat(84))
for (const c of cambios) {
  console.log('  ' + String(c.id).padEnd(6) + String(c.cliente).padEnd(16) +
    c.producto.padEnd(14) + c.estado.padEnd(12) + String(c.cantidad).padStart(4) +
    ('$' + c.de).padStart(8) + '  ->' + ('$' + c.a).padStart(8) +
    (c.yaEnviado ? '   ya enviado' : '   sin enviar'))
}
if (sinPareja.length) {
  console.log('')
  console.log('  SIN TOCAR (no hay pedido que encaje):')
  for (const s of sinPareja.slice(0, 10)) {
    console.log('    id ' + s.id + '  ' + (s.conversaciones || {}).cliente_id + '  ' + s.producto)
  }
}

if (!APLICAR) {
  console.log('')
  console.log('  ENSAYO. Nada escrito. Con --aplicar se manda.')
  process.exit(0)
}

// ── Aplicar ──────────────────────────────────────────────────────────────
const guion = cambios.map((c) =>
  `curl -s -o /dev/null -w '%{http_code} ' -X PATCH "$SUPABASE_URL/rest/v1/conversacion_productos?id=eq.${c.id}" \\
  -H "$H1" -H "$H2" -H "Content-Type: application/json" -d '{"precio": ${c.a}}'`).join('\n')

fs.writeFileSync(path.join(DIR, 'aplicar-precios.sh'),
  '\nset -a; . /opt/bot/wa.env; set +a\n' +
  'H1="apikey: $SUPABASE_SERVICE_ROLE"\n' +
  'H2="Authorization: Bearer $SUPABASE_SERVICE_ROLE"\n' +
  'echo "### PATCH de ' + cambios.length + ' filas"\n' +
  guion + '\necho\necho "  hecho"\n', 'utf8')
console.log('')
console.log('  Escrito el guion: aplicar-precios.sh  (' + cambios.length + ' PATCH)')
