#!/usr/bin/env node
/**
 * BANCO DE PRUEBAS del enrutado por TESTING.
 *
 * POR QUE NO SE PRUEBA PROVOCANDO UN PEDIDO REAL
 *   Para llegar a `Preparar pedido` haria falta una conversacion entera con
 *   un numero de WhatsApp. Con un numero inventado, el envio de «leido +
 *   escribiendo» falla contra Meta y la ejecucion se para ANTES del aviso,
 *   asi que no probaria nada; y con un numero real le estaria escribiendo a
 *   una persona.
 *
 * QUE SE HACE EN SU LUGAR
 *   Se ejecutan los DOS NODOS REALES, copiados tal cual del workflow vivo
 *   —el mismo `jsCode`, la misma expresion de `chat_id`—, con los nodos de
 *   los que leen puestos delante con SUS NOMBRES EXACTOS, para que
 *   `$('Leer Catálogo')`, `$('Variables')`, `$('AI Agent')` y
 *   `$('Juntar mensajes')` resuelvan sin tocar una coma del codigo.
 *
 *   El catalogo NO es de mentira: es el mismo Sheet, leido con la misma
 *   credencial. Asi la prueba pasa por la columna TESTING de verdad, con su
 *   nombre y sus valores de verdad.
 *
 * LO QUE ESTO PRUEBA Y LO QUE NO
 *   Prueba: que el codigo publicado decide bien el grupo y que Telegram
 *   entrega en el chat que toca, con las variables de entorno reales.
 *   No prueba: el cableado dentro del receptor. Eso se comprueba aparte,
 *   por SQL sobre el workflow vivo.
 *
 *   node construir-prueba-testing.js <receptor-vivo.json> <salida.json>
 */
const fs = require('fs')

const [entrada, salida] = process.argv.slice(2)
if (!entrada || !salida) {
  console.error('uso: node construir-prueba-testing.js <receptor.json> <salida.json>')
  process.exit(1)
}
const w = JSON.parse(fs.readFileSync(entrada, 'utf8'))
const dame = (n) => {
  const x = w.nodes.find((y) => y.name === n)
  if (!x) { console.error('ERROR: falta el nodo ' + n); process.exit(1) }
  return JSON.parse(JSON.stringify(x))
}

// Los DOS nodos que se prueban, copiados sin tocar nada.
const preparar = dame('Preparar pedido')
const avisar = dame('Avisar al dueño - Pedido')
const sheet = dame('Leer Catálogo')

// Comprobacion de que se esta copiando la version NUEVA y no un espejo viejo.
if (!/const es_testing = esSi\(testing_crudo\)/.test(preparar.parameters.jsCode)) {
  console.error('ERROR: «Preparar pedido» no trae la bandera; ¿es un JSON viejo?')
  process.exit(1)
}
if (!/TG_PEDIDOS_CHAT_TESTING/.test(avisar.parameters.jsonBody)) {
  console.error('ERROR: «Avisar al dueño - Pedido» no elige grupo; ¿es un JSON viejo?')
  process.exit(1)
}

const pos = (x, y) => [x, y]
let id = 0
const nuevo = (n) => Object.assign(n, { id: 'prueba-' + (++id) })

// El Sheet: mismo documento y misma credencial, con la hoja fija. Los dos
// canales tienen `catalogo_hoja` a null, asi que en produccion tambien cae
// en 'Productos' -- se comprobo contra la tabla antes de escribir esto.
sheet.parameters = {
  authentication: sheet.parameters.authentication,
  documentId: sheet.parameters.documentId,
  sheetName: { __rl: true, value: 'Productos', mode: 'name' },
  options: {},
}
sheet.position = pos(-200, 0)
nuevo(sheet)

const codigo = (nombre, js, x, y) => nuevo({
  parameters: { jsCode: js },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos(x, y),
  name: nombre,
})

const disparador = nuevo({
  parameters: { httpMethod: 'POST', path: 'prueba-testing', responseMode: 'responseNode', options: {} },
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position: pos(-460, 0),
  name: 'Disparador',
})

// Los nodos de los que lee `Preparar pedido`, con sus NOMBRES EXACTOS.
// El texto del cliente y la salida de María llegan por el webhook, para
// poder probar los dos casos con la misma pieza.
const variables = codigo('Variables', [
  '// Lo minimo que lee `Preparar pedido`. El numero es imposible a proposito:',
  '// aqui NO se envia nada a WhatsApp, pero si algun dia alguien reconecta',
  '// esto por error, que no le escriba a una persona.',
  "const b = $('Disparador').first().json.body || {};",
  'return [{ json: {',
  "  telefono_real: '5210000000001',",
  "  numero_cliente: '5210000000001',",
  "  nombre_cliente: 'PRUEBA TESTING',",
  "  fichas: ''",
  '} }];',
].join('\n'), 0, -200)

const juntar = codigo('Juntar mensajes', [
  "const b = $('Disparador').first().json.body || {};",
  "return [{ json: { texto_acumulado: String(b.texto || '') } }];",
].join('\n'), 0, 0)

const agente = codigo('AI Agent', [
  '// El bloque [PEDIDO] tal y como lo escribe María.',
  "const b = $('Disparador').first().json.body || {};",
  "return [{ json: { output: String(b.salida || '') } }];",
].join('\n'), 0, 200)

preparar.position = pos(240, 0)
nuevo(preparar)
avisar.position = pos(480, 0)
nuevo(avisar)

const responder = nuevo({
  parameters: {
    respondWith: 'json',
    responseBody: "={{ JSON.stringify({ es_testing: $('Preparar pedido').first().json.es_testing, testing_crudo: $('Preparar pedido').first().json.testing_crudo, producto: $('Preparar pedido').first().json.producto, producto_id: $('Preparar pedido').first().json.producto_id, chat_id_entregado: $json.result ? $json.result.chat.id : null, titulo_grupo: $json.result ? $json.result.chat.title : null, message_id: $json.result ? $json.result.message_id : null }) }}",
    options: {},
  },
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: pos(720, 0),
  name: 'Responder',
})

const fuera = {
  name: 'TEMP — prueba testing por producto (BORRAR)',
  nodes: [disparador, sheet, variables, juntar, agente, preparar, avisar, responder],
  connections: {
    Disparador: { main: [[{ node: 'Leer Catálogo', type: 'main', index: 0 }]] },
    'Leer Catálogo': { main: [[{ node: 'Variables', type: 'main', index: 0 }]] },
    Variables: { main: [[{ node: 'Juntar mensajes', type: 'main', index: 0 }]] },
    'Juntar mensajes': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
    'AI Agent': { main: [[{ node: 'Preparar pedido', type: 'main', index: 0 }]] },
    'Preparar pedido': { main: [[{ node: 'Avisar al dueño - Pedido', type: 'main', index: 0 }]] },
    'Avisar al dueño - Pedido': { main: [[{ node: 'Responder', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
}
fs.writeFileSync(salida, JSON.stringify(fuera, null, 2), 'utf8')
console.log('banco de pruebas escrito en ' + salida)
console.log('  nodos copiados sin tocar: Preparar pedido, Avisar al dueño - Pedido, Leer Catálogo')
