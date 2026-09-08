#!/usr/bin/env node
/**
 * Añade al receptor el nodo que ESCRIBE la marca de escalado en Supabase.
 *
 * Se genera con un script y no a mano porque el fichero del receptor son
 * 130 nodos en una sola línea: un editor de texto ahí es una forma cara de
 * romper un JSON de producción sin enterarte.
 *
 *   node anadir-marca-escalado.js <vivo.json> <salida.json>
 *
 * La entrada se pasa POR ARGUMENTO y no está a fuego, y eso no es cosmético:
 * la primera versión leía el espejo del repo, y entre generarlo y subirlo
 * cambió el receptor (se aplicó lo del contexto, 130 nodos -> 128). Subir
 * aquel fichero habría REVERTIDO el arreglo del contexto sin un solo error.
 * Se genera SIEMPRE contra un GET recién bajado del vivo.
 *
 * NO toca n8n. Solo escribe un fichero.
 */
const fs = require('fs')

const [, , origen, destino] = process.argv
if (!origen || !destino) {
  console.error('uso: node anadir-marca-escalado.js <vivo.json> <salida.json>')
  process.exit(1)
}

const wf = JSON.parse(fs.readFileSync(origen, 'utf8'))

const nombre = 'Marcar escalada'
if (wf.nodes.some((n) => n.name === nombre)) {
  console.error('Ya existe un nodo "' + nombre + '". No se toca nada.')
  process.exit(1)
}

// Los tres nodos de los que depende. Si el receptor cambia de forma, esto
// TIENE que fallar aquí y no en producción con un cliente delante.
for (const dep of ['Preparar aviso', 'Variables', 'Hay que escalar?']) {
  if (!wf.nodes.some((n) => n.name === dep)) {
    console.error('Falta el nodo "' + dep + '" del que cuelga esto. Aborto.')
    process.exit(1)
  }
}

// La plantilla del PATCH sale de un nodo que YA funciona contra la misma
// tabla, para no inventarse las cabeceras.
const modelo = wf.nodes.find((n) => n.name === 'Apagar tras el pedido')
if (!modelo) {
  console.error('No encuentro "Apagar tras el pedido", que es el modelo del PATCH. Aborto.')
  process.exit(1)
}

// Un hueco libre en el lienzo, para que no caiga encima de otro nodo.
const ocupado = new Set(wf.nodes.map((n) => n.position.join(',')))
let pos = [2560, 1152]
while (ocupado.has(pos.join(','))) pos = [pos[0], pos[1] + 96]

wf.nodes.push({
  parameters: {
    method: 'PATCH',
    url: "={{ $env.SUPABASE_URL }}/rest/v1/conversaciones?cliente_id=eq.{{ $('Variables').first().json.numero_cliente }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_ROLE }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_ROLE }}' },
        { name: 'Content-Type', value: 'application/json' },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    // El motivo ya lo extrajo "Preparar aviso": se REUTILIZA en vez de
    // repetir la expresión regular. Dos copias de la misma regex acaban
    // discrepando el día que alguien toque una sola.
    jsonBody:
      "={{ JSON.stringify({ escalada_en: new Date().toISOString(), escalada_motivo: String($('Preparar aviso').item.json.motivo || '').slice(0, 300) }) }}",
    options: {},
  },
  id: 'marcar-escalada-supabase',
  name: nombre,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: modelo.typeVersion,
  position: pos,
  // SIN onError y SIN neverError, a propósito.
  //
  // Si este PATCH falla, María ya se ha callado con el cliente y en el
  // inbox no aparece nada: la conversación queda muerta y muda, que es
  // exactamente el fallo que esto viene a tapar. Tragarse el error aquí
  // sería apagar la alarma de incendios (lección del 22 de agosto).
  //
  // Va el ÚLTIMO de los tres hijos de "Preparar aviso" para que, si
  // revienta, el aviso de Telegram y la fila del Sheet ya hayan salido.
})

const salida = wf.connections['Preparar aviso'].main[0]
salida.push({ node: nombre, type: 'main', index: 0 })

// El PUT de la API pública solo acepta estas claves. Ojo con `activeVersion`,
// que el GET sí devuelve: es una copia congelada de la versión publicada y
// colarla aquí no haría más que confundir a quien luego busque algo dentro.
const limpio = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
}
if (wf.staticData) limpio.staticData = wf.staticData

fs.writeFileSync(destino, JSON.stringify(limpio, null, 2) + '\n', 'utf8')

console.log('Escrito: ' + destino)
console.log('  nodos:    ' + wf.nodes.length)
console.log('  posicion: ' + pos.join(','))
console.log('  hijos de «Preparar aviso»: ' + salida.map((c) => c.node).join(' -> '))
console.log('  claves del PUT: ' + Object.keys(limpio).join(', '))
console.log('  executionOrder: ' + (wf.settings && wf.settings.executionOrder))

// Que el arreglo del contexto siga dentro. Si esto salta, la entrada era un
// espejo viejo y subirlo habría deshecho el cambio anterior.
const texto = JSON.stringify(limpio)
console.log('  el contexto sigue en solo-referral: ' +
  (texto.includes('SOLO el referral del anuncio') ? 'sí' : 'NO — PARA'))
if (!texto.includes('SOLO el referral del anuncio')) process.exit(1)
