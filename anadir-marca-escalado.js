#!/usr/bin/env node
/**
 * Añade al receptor el nodo que ESCRIBE la marca de escalado en Supabase.
 *
 * Se genera con un script y no a mano porque el fichero del receptor son
 * 130 nodos en una sola línea: un editor de texto ahí es una forma cara de
 * romper un JSON de producción sin enterarte.
 *
 * Entrada:  workflows/receptor-multicanal-historial.json   (espejo del vivo)
 * Salida:   workflows/receptor-multicanal-escalado.json    (para IMPORTAR)
 *
 * NO toca n8n. Solo escribe un fichero.
 */
const fs = require('fs')
const path = require('path')

const raiz = __dirname
const origen = path.join(raiz, 'workflows', 'receptor-multicanal-historial.json')
const destino = path.join(raiz, 'workflows', 'receptor-multicanal-escalado.json')

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

fs.writeFileSync(destino, JSON.stringify(wf, null, 2) + '\n', 'utf8')

console.log('Escrito: ' + path.relative(raiz, destino))
console.log('  nodos:    ' + wf.nodes.length)
console.log('  posicion: ' + pos.join(','))
console.log('  hijos de "Preparar aviso": ' + salida.map((c) => c.node).join(' -> '))
console.log('  executionOrder: ' + (wf.settings && wf.settings.executionOrder))
