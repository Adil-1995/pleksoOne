#!/usr/bin/env node
/**
 * TESTING POR PRODUCTO — el aviso del pedido va al grupo de pruebas.
 *
 * QUE HACE
 *   El Sheet del catalogo tiene una columna TESTING (si/no). Si el producto
 *   que pide el cliente la tiene en "si", el aviso de pedido se manda al
 *   grupo «Pedidos MX — TESTING» en vez de a «Pedidos MX». Todo lo demas
 *   —guardar el pedido, marcarlo pendiente, el carrito del inbox, apagar el
 *   bot— sigue exactamente igual.
 *
 * TRES CAMBIOS, Y EL PRIMERO ES UN FALLO QUE YA ESTABA VIVO
 *
 *   1. `Preparar Catalogo` deja de mandarle la columna al modelo.
 *      Ese nodo es lista NEGRA: cualquier columna nueva del Sheet entra
 *      sola en el texto del catalogo. Comprobado en la ejecucion 49843:
 *      Maria ya esta recibiendo «Testing: NO» y «Testing: SI» como si fuera
 *      una caracteristica del producto. No es hipotetico, esta pasando.
 *
 *   2. `Preparar pedido` lee la columna POR NOMBRE y saca `es_testing`.
 *      Por nombre y no por posicion, con la misma normalizacion que ya usa
 *      el proyecto para 'garantia': minusculas, sin tildes, espacios a "_".
 *      Asi da igual que la columna este en la D, que se mueva, o que
 *      alguien la escriba «Testing » con un espacio detras.
 *
 *      SOLO la cadena "si" cuenta como si. Vacia, ausente, "no", "yes" o
 *      cualquier otra cosa cuentan como NO. La regla va en esa direccion a
 *      proposito: equivocarse hacia "no" manda un pedido de pruebas al
 *      grupo real —molesto—; equivocarse hacia "si" manda un pedido REAL al
 *      grupo de pruebas, donde nadie lo va a preparar. Lo segundo es una
 *      venta perdida, asi que la duda cae siempre del lado de Pedidos MX.
 *
 *      Y si el producto no se pudo identificar (`producto_id` null) tambien
 *      es NO: un pedido sin producto tiene que llegar al grupo real si o si.
 *
 *   3. `Avisar al dueno - Pedido` elige el chat segun esa bandera.
 *      Los dos ids viven en wa.env, como hasta ahora. Si falta la variable
 *      del grupo de pruebas, Telegram devuelve 400 y la ejecucion FALLA a
 *      la vista. Es deliberado: el repliegue silencioso al grupo real seria
 *      justo el error que el punto 2 evita, pero por la puerta de atras.
 *
 * LO QUE NO SE TOCA AQUI: el CAPI. Va en su propia tanda, sobre el workflow
 * de validacion.
 *
 *   node anadir-testing-por-producto.js <entrada.json> <salida.json>
 */
const fs = require('fs')

const [entrada, salida] = process.argv.slice(2)
if (!entrada || !salida) {
  console.error('uso: node anadir-testing-por-producto.js <entrada.json> <salida.json>')
  process.exit(1)
}

const w = JSON.parse(fs.readFileSync(entrada, 'utf8'))

// ── Guardas: sobre un espejo viejo esto haria un destrozo silencioso ──────
if (w.id !== 'qx1O54zpuyxzfW8V') {
  console.error('ERROR: esto es el workflow ' + w.id + ', no el receptor vivo qx1O54zpuyxzfW8V')
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

let tocados = 0

// ── 1. El catalogo deja de mandarle la columna al modelo ──────────────────
{
  const n = nodo('Preparar Catálogo')
  let c = n.parameters.jsCode
  if (/'testing'/.test(c)) {
    console.log('  = Preparar Catálogo ya excluía testing')
  } else {
    const aguja = "  'ficha_texto'                          // es el texto que se ENVÍA; si entra, lo recita"
    unaVez(c, aguja, 'Preparar Catálogo')
    c = c.replace(aguja,
      "  'ficha_texto',                         // es el texto que se ENVÍA; si entra, lo recita\n" +
      "  'testing'                              // enrutado del aviso, NO es del producto")
    n.parameters.jsCode = c
    tocados++
    console.log('  + Preparar Catálogo: testing fuera del texto que ve el modelo')
  }
}

// ── 2. Preparar pedido saca la bandera ────────────────────────────────────
{
  const n = nodo('Preparar pedido')
  let c = n.parameters.jsCode
  if (/es_testing/.test(c)) {
    console.log('  = Preparar pedido ya calculaba es_testing')
  } else {
    const bloque = [
      '// ── TESTING: ¿a qué grupo de Telegram va el aviso? ───────────────────',
      '// La columna se lee POR NOMBRE, no por posición: la misma normalización',
      "// que el resto del proyecto usa para 'garantía' (minúsculas, sin tildes,",
      '// espacios a "_"). Así aguanta que la muevan de la D, que la renombren',
      '// «Testing » con un espacio o que la escriban en mayúsculas.',
      'function claveCol(n) {',
      "  return String(n || '').toLowerCase()",
      "    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')",
      "    .trim().replace(/\\s+/g, '_');",
      '}',
      '// SOLO "si" es que sí. Vacía, ausente o cualquier otra cosa es NO.',
      '// La duda cae SIEMPRE del lado de Pedidos MX: mandar un pedido de pruebas',
      '// al grupo real es molesto; mandar uno REAL al grupo de pruebas es una',
      '// venta que nadie prepara.',
      'function esSi(v) {',
      "  return String(v === null || v === undefined ? '' : v).trim().toLowerCase()",
      "    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '') === 'si';",
      '}',
      '',
      'let testing_crudo = null;',
      '// Sin producto identificado NO hay testing: ese pedido tiene que llegar al',
      '// grupo real igualmente, que es donde alguien lo va a mirar a mano.',
      'if (producto_id) {',
      "  for (const item of $('Leer Catálogo').all()) {",
      "    if (String(item.json.id || '').trim() !== String(producto_id)) continue;",
      '    for (const k of Object.keys(item.json)) {',
      "      if (claveCol(k) === 'testing') { testing_crudo = item.json[k]; break; }",
      '    }',
      '    break;',
      '  }',
      '}',
      'const es_testing = esSi(testing_crudo);',
      '',
    ].join('\n')

    const aguja = "const producto = elegido ? elegido.nombre : '⚠️ No confirmado — ver conversación';"
    unaVez(c, aguja, 'Preparar pedido')
    c = c.replace(aguja, bloque + aguja)

    const aguja2 = "const aviso = [\n  '🛒🛒🛒 *NUEVO PEDIDO* 🛒🛒🛒',"
    unaVez(c, aguja2, 'Preparar pedido (cabecera del aviso)')
    c = c.replace(aguja2,
      'const aviso = [\n' +
      "  es_testing ? '🧪 PRODUCTO EN TESTING — este aviso NO va a Pedidos MX' : null,\n" +
      "  '🛒🛒🛒 *NUEVO PEDIDO* 🛒🛒🛒',")

    const aguja3 = "  '🗂️ Abrir en PleksOne: ' + enlaceInbox\n].join('\\n');"
    unaVez(c, aguja3, 'Preparar pedido (cierre del aviso)')
    c = c.replace(aguja3, "  '🗂️ Abrir en PleksOne: ' + enlaceInbox\n].filter(Boolean).join('\\n');")

    const aguja4 = '    producto_id,\n    datos_cliente: datosCliente,'
    unaVez(c, aguja4, 'Preparar pedido (salida)')
    c = c.replace(aguja4,
      '    producto_id,\n' +
      '    // A qué grupo va el aviso. `testing_crudo` se devuelve para poder ver\n' +
      '    // en la ejecución QUÉ traía la columna, no solo la decisión: si algún\n' +
      '    // día enruta mal, se ve el dato de entrada sin abrir el Sheet.\n' +
      '    es_testing, testing_crudo,\n' +
      '    datos_cliente: datosCliente,')

    n.parameters.jsCode = c
    tocados++
    console.log('  + Preparar pedido: lee TESTING por nombre y saca es_testing')
  }
}

// ── 3. El aviso elige grupo ───────────────────────────────────────────────
{
  const n = nodo('Avisar al dueño - Pedido')
  const antes = n.parameters.jsonBody
  if (/TG_PEDIDOS_CHAT_TESTING/.test(antes)) {
    console.log('  = Avisar al dueño - Pedido ya elegía grupo')
  } else {
    unaVez(antes, '$env.TG_PEDIDOS_CHAT', 'Avisar al dueño - Pedido')
    n.parameters.jsonBody =
      "={{ JSON.stringify({ chat_id: $('Preparar pedido').first().json.es_testing" +
      ' ? $env.TG_PEDIDOS_CHAT_TESTING : $env.TG_PEDIDOS_CHAT,' +
      " text: $('Preparar pedido').first().json.aviso_pedido }) }}"
    tocados++
    console.log('  + Avisar al dueño - Pedido: elige grupo según es_testing')
  }
}

// ── Salida: SOLO lo que acepta el PUT de la API publica ───────────────────
const fuera = {
  name: w.name,
  nodes: w.nodes,
  connections: w.connections,
  settings: w.settings || {},
}
fs.writeFileSync(salida, JSON.stringify(fuera, null, 2), 'utf8')
console.log('\nnodos tocados: ' + tocados + '  ->  ' + salida)
