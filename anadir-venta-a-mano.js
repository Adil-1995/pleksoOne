#!/usr/bin/env node
/**
 * LA VENTA QUE TOMA UNA PERSONA TAMBIÉN SE APUNTA.
 *
 * EL PROBLEMA
 *   Cuando un humano cierra la venta desde el inbox y marca el producto como
 *   `validado`, no pasa por `Guardar pedido` del receptor — que es el nodo
 *   que escribe la fila en `pedidos` Y rellena `conversacion_productos.precio`
 *   y `.cantidad`. Resultado: ni pedido, ni precio, y por tanto tampoco
 *   Purchase al CAPI, porque «Construir evento» se niega a mandar un importe
 *   incompleto (y hace bien).
 *
 *   Medido el 8/9/2026 sobre las 122 ventas validadas por una persona desde
 *   el 21/8: 15 sin fila en `pedidos`, 16 sin precio, 34 que no llegaron al
 *   CAPI. Un mismo fallo con tres caras.
 *
 * DÓNDE SE ENGANCHA, Y POR QUÉ AHÍ
 *   El inbox ya llama a este workflow al validar (`avisarPurchase` en
 *   inbox/src/lib/envio.ts). Se mete ANTES de «Tomar el cerrojo» a propósito:
 *   si el precio se rellenara después, el CAPI ya habría leído la línea sin
 *   precio y habría fallado. Y no hay reintento — `capi_intentos` se escribe
 *   pero no lo lee nadie —, así que ese evento se perdería para siempre.
 *
 *   Rellenar el precio ANTES del cerrojo arregla las dos cosas de una vez:
 *   la fila en `pedidos` y el Purchase.
 *
 * LO QUE NO SE INVENTA
 *   - El PRECIO sale del catálogo (Google Sheet), nunca del texto de nadie.
 *     Es la misma regla que `Preparar pedido` del receptor. Si el producto no
 *     está en el catálogo NO se apunta la venta: se avisa y se para. Un
 *     importe inventado ensucia la optimización de Meta para siempre.
 *   - La CANTIDAD se pone a 1, que es lo único que se puede saber sin
 *     preguntar. VA DICHO EN EL AVISO para poder corregirlo.
 *   - `datos_cliente` se saca del último mensaje ENTRANTE que parezca una
 *     dirección. También VA DICHO en el aviso, con la hora del mensaje del
 *     que salió, para poder comprobarlo de un vistazo.
 *
 *   Las dos suposiciones se anuncian porque una caída a un valor por defecto
 *   que no avisa es la del 22 de agosto otra vez.
 *
 *   node anadir-venta-a-mano.js <capi-vivo.json> <salida.json>
 */
const fs = require('fs')

const [, , origen, destino] = process.argv
if (!origen || !destino) {
  console.error('uso: node anadir-venta-a-mano.js <capi-vivo.json> <salida.json>')
  process.exit(1)
}

const wf = JSON.parse(fs.readFileSync(origen, 'utf8'))

const SESION = '¿Sesión válida?'
const CERROJO = 'Tomar el cerrojo'
const TOKEN = 'Sacar el token'

for (const n of [SESION, CERROJO, TOKEN, 'Leer conversación y canal']) {
  if (!wf.nodes.some((x) => x.name === n)) {
    console.error('Falta el nodo «' + n + '». Aborto.')
    process.exit(1)
  }
}
if (wf.nodes.some((x) => x.name === 'Preparar venta a mano')) {
  console.error('Ya está puesto. No se toca nada.')
  process.exit(1)
}

// La plantilla de cabeceras de Supabase, de un nodo que ya funciona aquí.
const modeloHttp = wf.nodes.find((x) => x.name === 'Leer conversación y canal')
const CAB_SUPABASE = JSON.parse(JSON.stringify(modeloHttp.parameters.headerParameters))

// La credencial de Postgres NO está en este workflow —el CAPI solo habla con
// Supabase y con Meta—, así que se trae la misma que usa «Guardar pedido» del
// receptor. Es la que apunta a appdb, donde vive `pedidos`.
const CRED_POSTGRES = { postgres: { id: 'gAfz3X2t0Fnirf7w', name: 'Postgres account 2' } }

const idConv = "{{ $('" + TOKEN + "').first().json.body.conversacion_id }}"

const nuevos = []
const pos = (x, y) => [x, y]

// ── 1. La venta: conversación, canal y líneas ────────────────────────────
nuevos.push({
  parameters: {
    url: '={{ $env.SUPABASE_URL }}/rest/v1/conversaciones?id=eq.' + idConv +
      '&select=id,cliente_id,nombre,canales(catalogo_hoja),conversacion_productos(id,producto,estado,precio,cantidad,validado_en)',
    sendHeaders: true,
    headerParameters: CAB_SUPABASE,
    options: { response: { response: { fullResponse: true } } },
  },
  id: 'venta-leer', name: 'Leer venta a mano',
  type: 'n8n-nodes-base.httpRequest', typeVersion: modeloHttp.typeVersion,
  position: pos(60, 40),
})

// ── 2. El catálogo. Clonado del receptor, con su cuenta de servicio ──────
//     `catalogo_hoja` es null en los dos canales de hoy, así que cae a
//     'Productos', igual que en el receptor.
nuevos.push({
  parameters: {
    authentication: 'serviceAccount',
    documentId: {
      __rl: true,
      value: '1NKp7pJ-Fx-yE8IKM-Kgy_cB7d9ToVd6ECyNybDteUPQ',
      mode: 'list',
      cachedResultName: 'Pedidos MX Whatsapp Glowbrush Auto',
      cachedResultUrl: 'https://docs.google.com/spreadsheets/d/1NKp7pJ-Fx-yE8IKM-Kgy_cB7d9ToVd6ECyNybDteUPQ/edit?usp=drivesdk',
    },
    sheetName: {
      __rl: true,
      value: "={{ ($('Leer venta a mano').first().json.body[0]?.canales?.catalogo_hoja) || 'Productos' }}",
      mode: 'name',
    },
    options: {},
  },
  id: 'venta-catalogo', name: 'Leer catálogo de la venta',
  type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7,
  position: pos(280, 40),
  credentials: { googleApi: { id: 'aRfirRPV9iB2zikq', name: 'Google Sheets account' } },
  // EL ÚNICO onError DE TODO ESTO, y con motivo.
  //
  // Google Sheets es una dependencia NUEVA en el camino del CAPI: hasta hoy
  // este workflow solo hablaba con Supabase y con Meta. Si el Sheet se cae y
  // esto revienta, se deja de mandar el Purchase de una venta que sí está
  // bien — se rompería algo que funciona por arreglar algo que no.
  //
  // Con esto, si el catálogo no responde, «Preparar venta a mano» no
  // encuentra precio, pone accion='avisar', NO apunta nada y manda el aviso
  // diciendo por qué. El CAPI sigue su camino como hasta hoy.
  //
  // No es tragarse el error: es degradar EN VOZ ALTA. La diferencia con el
  // 22 de agosto es que allí el fallo no salía por ninguna parte.
  onError: 'continueRegularOutput',
})

// ── 3. Los últimos mensajes del cliente, para sacar la dirección ─────────
nuevos.push({
  parameters: {
    url: "={{ $env.SUPABASE_URL }}/rest/v1/mensajes?cliente_id=eq.{{ $('Leer venta a mano').first().json.body[0].cliente_id }}&direccion=eq.in&order=creado.desc&limit=25&select=texto,creado",
    sendHeaders: true,
    headerParameters: CAB_SUPABASE,
    options: { response: { response: { fullResponse: true } } },
  },
  id: 'venta-mensajes', name: 'Leer datos del cliente',
  type: 'n8n-nodes-base.httpRequest', typeVersion: modeloHttp.typeVersion,
  position: pos(500, 40),
})

// ── 4. ¿Ya está apuntada? ────────────────────────────────────────────────
//     Se compara por los ÚLTIMOS 10 DÍGITOS y no por la cadena entera:
//     `pedidos.telefono` y `conversaciones.cliente_id` no siempre se escriben
//     igual, y un fallo aquí duplicaría una venta.
nuevos.push({
  parameters: {
    operation: 'executeQuery',
    query: 'SELECT count(*)::int AS ya_esta FROM pedidos WHERE telefono LIKE $1;',
    options: {
      queryReplacement: "={{ [ '%' + String($('Leer venta a mano').first().json.body[0].cliente_id).replace(/\\D/g,'').slice(-10) ] }}",
    },
  },
  id: 'venta-ya-esta', name: '¿Ya hay pedido?',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6,
  position: pos(720, 40),
  credentials: CRED_POSTGRES,
})

// ── 5. La decisión, en un solo sitio ─────────────────────────────────────
const CODIGO = String.raw`
// PREPARAR VENTA A MANO
//
// Decide si hay que apuntar la venta que acaba de validar una persona, y con
// qué datos. No escribe nada: solo decide y deja dicho lo que ha supuesto.

const conv = (function () {
  const r = $('Leer venta a mano').first().json || {};
  let c = r.body;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) {} }
  if (!Array.isArray(c) || !c.length) {
    throw new Error('Venta a mano: no encuentro la conversación ' +
      $('Sacar el token').first().json.body.conversacion_id);
  }
  return c[0];
})();

// Las líneas que una PERSONA ha validado. «validado_en» es lo que distingue
// una validación humana de una fila que puso el flujo.
const lineas = (conv.conversacion_productos || [])
  .filter(function (l) { return l.estado === 'validado' && l.validado_en; });

const yaEsta = (($('¿Ya hay pedido?').first().json || {}).ya_esta || 0) > 0;

// ---------- PRECIO DEL CATÁLOGO, NUNCA DE OTRO SITIO ----------
// Misma regla que «Preparar pedido» del receptor: el precio sale del Sheet.
// Sin precio no se apunta nada, porque un importe inventado se va al CAPI y
// Meta optimiza con él.
function precioDe(idProducto) {
  for (const item of $('Leer catálogo de la venta').all()) {
    const fila = item.json;
    if (String(fila.id || '').trim() !== String(idProducto).trim()) continue;
    const n = String(fila.precio || '').replace(/[^0-9.]/g, '');
    return n === '' ? null : parseFloat(n);
  }
  return null;
}
function nombreDe(idProducto) {
  for (const item of $('Leer catálogo de la venta').all()) {
    const fila = item.json;
    if (String(fila.id || '').trim() === String(idProducto).trim()) {
      return String(fila.nombre || idProducto);
    }
  }
  return String(idProducto);
}

// ---------- LOS DATOS DE ENVÍO ----------
// Del último mensaje ENTRANTE que parezca una dirección. Se exigen dos
// señales de las que se le piden al cliente (calle, entre, colonia, CP...)
// además de dígitos y 8+ palabras: con menos, «El de 12 luces pero cuánto
// tarda» pasaría por dirección.
const SENALES = [
  /\bcalle\b/i, /\bcolonia\b|\bcol\.?\s/i, /\bentre\b/i,
  /\bc\.?\s?p\.?\s*\d{4,5}\b/i, /#\s*\d/, /\bav\.?\b|\bavenida\b/i,
  /\bnombre\s*:/i, /\bmunicipio\b/i, /\bn[uú]m(ero)?\.?\s*\d/i,
  /\bint(erior)?\.?\s*\d/i, /\bfracc/i, /\bmz\b|\bmanzana\b/i,
];
function pareceDireccion(t) {
  const s = String(t || '');
  if (s.includes('?')) return false;
  if (!/\d/.test(s)) return false;
  if (s.trim().split(/\s+/).length < 8) return false;
  let n = 0;
  for (const r of SENALES) if (r.test(s)) n++;
  return n >= 2;
}

let datosCliente = '';
let deQueMensaje = '';
(function () {
  const r = $('Leer datos del cliente').first().json || {};
  let c = r.body;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) {} }
  if (!Array.isArray(c)) return;
  for (const m of c) {                    // vienen del más nuevo al más viejo
    if (pareceDireccion(m.texto)) {
      datosCliente = String(m.texto);
      deQueMensaje = String(m.creado || '').slice(0, 16).replace('T', ' ');
      return;
    }
  }
})();

// ---------- La decisión ----------
let accion = 'nada';
let motivo = '';
const suposiciones = [];

if (!lineas.length) {
  accion = 'nada';
  motivo = 'ninguna línea validada por una persona';
} else if (yaEsta) {
  accion = 'nada';
  motivo = 'esta venta ya está apuntada en pedidos';
} else {
  const sinPrecio = lineas.filter(function (l) { return precioDe(l.producto) === null; });
  if (sinPrecio.length) {
    accion = 'avisar';
    motivo = 'el catálogo no tiene precio para: ' +
      sinPrecio.map(function (l) { return l.producto; }).join(', ');
  } else {
    accion = 'apuntar';
    suposiciones.push('CANTIDAD = 1 por defecto (nadie la dijo)');
    if (datosCliente) {
      suposiciones.push('DATOS sacados del mensaje del cliente de las ' + deQueMensaje);
    } else {
      suposiciones.push('SIN DATOS DE ENVÍO: no hay ningún mensaje suyo que parezca una dirección');
    }
  }
}

// ---------- La fila de pedidos ----------
const CANTIDAD_POR_DEFECTO = 1;
const importe = lineas.reduce(function (t, l) {
  const p = precioDe(l.producto);
  return t + (p === null ? 0 : p * CANTIDAD_POR_DEFECTO);
}, 0);

const nombres = lineas.map(function (l) { return nombreDe(l.producto); }).join(' + ');

// ---------- El aviso ----------
// Dice SIEMPRE lo que se ha supuesto. Un valor por defecto que no se anuncia
// es un dato inventado con otro nombre.
const aviso = [
  accion === 'apuntar' ? '🧾 VENTA APUNTADA A MANO' : '⚠️ VENTA A MANO SIN APUNTAR',
  '',
  '📱 Cliente: ' + conv.cliente_id + (conv.nombre ? '  (' + conv.nombre + ')' : ''),
  '📦 Producto: ' + (nombres || '—'),
  '💵 Importe: $' + importe + '  MXN',
  '',
  accion === 'apuntar'
    ? '⚠️ Revisa esto, que lo he supuesto yo:\n   · ' + suposiciones.join('\n   · ')
    : '❌ No se ha apuntado: ' + motivo,
  '',
  datosCliente ? '📍 Datos de envío:\n' + datosCliente : '📍 Sin datos de envío en la conversación',
].join('\n');

return [{ json: {
  accion,
  motivo,
  suposiciones,
  hay_algo_que_decir: accion !== 'nada',
  se_puede_apuntar: accion === 'apuntar',
  // Para la fila de pedidos, en el mismo orden que «Guardar pedido»
  telefono: conv.cliente_id,
  nombre_wa: conv.nombre || '',
  producto: nombres,
  cantidad: String(CANTIDAD_POR_DEFECTO),
  precio: String(importe),
  datos_cliente: datosCliente || '(no se encontró en la conversación)',
  // Para rellenar las líneas, que es lo que desbloquea el CAPI
  ids_lineas: lineas.map(function (l) { return l.id; }),
  precio_unitario: lineas.length ? precioDe(lineas[0].producto) : null,
  aviso,
} }];
`.trim()

nuevos.push({
  parameters: { jsCode: CODIGO },
  id: 'venta-preparar', name: 'Preparar venta a mano',
  type: 'n8n-nodes-base.code', typeVersion: 2,
  position: pos(940, 40),
})

// ── 6 y 7. Los dos IF ────────────────────────────────────────────────────
const condicion = (id, expr) => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 1 },
  conditions: [{
    id, leftValue: expr, rightValue: '',
    operator: { type: 'boolean', operation: 'true', singleValue: true },
  }],
  combinator: 'and',
})

nuevos.push({
  parameters: { conditions: condicion('hay-algo', "={{ $json.hay_algo_que_decir }}"), options: {} },
  id: 'venta-hay-algo', name: '¿Hay venta que apuntar?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos(1160, 40),
})
nuevos.push({
  parameters: { conditions: condicion('se-puede', "={{ $json.se_puede_apuntar }}"), options: {} },
  id: 'venta-se-puede', name: '¿Se puede apuntar?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos(1380, 40),
})

// ── 8. La fila. MISMA sentencia que «Guardar pedido» del receptor ────────
nuevos.push({
  parameters: {
    operation: 'executeQuery',
    query: 'INSERT INTO pedidos (telefono, nombre_wa, producto, cantidad, precio, datos_cliente)\nVALUES ($1, $2, $3, $4, $5, $6)\nRETURNING id;',
    options: {
      queryReplacement: '={{ [ $json.telefono, $json.nombre_wa, $json.producto, $json.cantidad, $json.precio, $json.datos_cliente ] }}',
    },
  },
  id: 'venta-apuntar', name: 'Apuntar venta a mano',
  type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: pos(1600, -80),
  credentials: CRED_POSTGRES,
})

// ── 9. Y el precio en las líneas, que es lo que desbloquea el CAPI ───────
nuevos.push({
  parameters: {
    method: 'PATCH',
    url: "={{ $env.SUPABASE_URL }}/rest/v1/conversacion_productos?id=in.({{ $('Preparar venta a mano').first().json.ids_lineas.join(',') }})",
    sendHeaders: true,
    headerParameters: CAB_SUPABASE,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ precio: $('Preparar venta a mano').first().json.precio_unitario, cantidad: 1 }) }}",
    options: {},
  },
  id: 'venta-precio', name: 'Rellenar precio y cantidad',
  type: 'n8n-nodes-base.httpRequest', typeVersion: modeloHttp.typeVersion,
  position: pos(1820, -80),
})

// ── 10. El aviso ─────────────────────────────────────────────────────────
nuevos.push({
  parameters: {
    method: 'POST',
    url: '=https://api.telegram.org/bot{{ $env.TG_PEDIDOS_TOKEN }}/sendMessage',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ chat_id: $env.TG_PEDIDOS_CHAT, text: $('Preparar venta a mano').first().json.aviso }) }}",
    options: {},
  },
  id: 'venta-avisar', name: 'Avisar venta a mano',
  type: 'n8n-nodes-base.httpRequest', typeVersion: modeloHttp.typeVersion,
  position: pos(2040, 40),
})

wf.nodes = wf.nodes.concat(nuevos)

// ── El cableado ──────────────────────────────────────────────────────────
// TODOS los caminos terminan en «Tomar el cerrojo». Es la forma que pide la
// lección del 22 de agosto: nada de ramas sueltas que se queden colgando.
const a = (n) => [{ node: n, type: 'main', index: 0 }]
wf.connections[SESION].main[0] = a('Leer venta a mano')
wf.connections['Leer venta a mano'] = { main: [a('Leer catálogo de la venta')] }
wf.connections['Leer catálogo de la venta'] = { main: [a('Leer datos del cliente')] }
wf.connections['Leer datos del cliente'] = { main: [a('¿Ya hay pedido?')] }
wf.connections['¿Ya hay pedido?'] = { main: [a('Preparar venta a mano')] }
wf.connections['Preparar venta a mano'] = { main: [a('¿Hay venta que apuntar?')] }
wf.connections['¿Hay venta que apuntar?'] = { main: [a('¿Se puede apuntar?'), a(CERROJO)] }
wf.connections['¿Se puede apuntar?'] = { main: [a('Apuntar venta a mano'), a('Avisar venta a mano')] }
wf.connections['Apuntar venta a mano'] = { main: [a('Rellenar precio y cantidad')] }
wf.connections['Rellenar precio y cantidad'] = { main: [a('Avisar venta a mano')] }
wf.connections['Avisar venta a mano'] = { main: [a(CERROJO)] }

const limpio = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
}
if (wf.staticData) limpio.staticData = wf.staticData

fs.writeFileSync(destino, JSON.stringify(limpio, null, 2) + '\n', 'utf8')

console.log('Escrito: ' + destino)
console.log('  nodos:  ' + wf.nodes.length + ' (antes ' + (wf.nodes.length - nuevos.length) + ')')
console.log('  claves: ' + Object.keys(limpio).join(', '))
console.log('')
console.log('  camino nuevo:')
console.log('    ' + SESION + ' -> Leer venta a mano -> catálogo -> datos -> ¿Ya hay pedido?')
console.log('    -> Preparar venta a mano -> ¿Hay venta que apuntar?')
console.log('         no  -> ' + CERROJO)
console.log('         sí  -> ¿Se puede apuntar?')
console.log('                 sí -> Apuntar -> Rellenar precio -> Avisar -> ' + CERROJO)
console.log('                 no -> Avisar -> ' + CERROJO)

const cred = (wf.nodes.find((n) => n.name === '¿Ya hay pedido?') || {}).credentials
console.log('')
console.log('  credencial de Postgres heredada: ' + (cred ? JSON.stringify(cred) : 'NINGUNA — PARA'))
if (!cred) process.exit(1)
