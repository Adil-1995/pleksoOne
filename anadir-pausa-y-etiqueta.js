#!/usr/bin/env node
/**
 * AL ESCALAR: María se pausa sola, y la conversación se etiqueta.
 *
 * 1. LA PAUSA
 *    Desde 116bd5c, cuando María emite el marcador se calla ESE TURNO. Pero
 *    sigue activa: al mensaje siguiente vuelve a contestar, y puede hacerlo
 *    encima de la persona que ya está atendiendo el caso a mano. Ahora se
 *    pausa de verdad: `bot_activo = false`.
 *
 *    LA REACTIVACIÓN NO CAMBIA. Se sigue haciendo con «Devolvérsela» en la
 *    cabecera, igual que una pausa puesta a mano. Y el botón «Resuelto» de la
 *    franja de escalado NO toca la pausa: solo escribe `escalada_vista_en`
 *    (ver `resolverEscalado` en inbox/src/lib/conversaciones.ts). Son dos
 *    cosas distintas a propósito — cerrar el aviso no es devolverle el
 *    cliente al bot.
 *
 *    NO PISA UNA PAUSA ANTERIOR: el PATCH lleva el filtro `bot_activo=is.true`,
 *    así que si alguien ya la había pausado por otro motivo, esa fila no se
 *    toca siquiera. PostgREST devuelve [] y no pasa nada.
 *
 * 2. LA ETIQUETA
 *    La columna `escalada_en` SIGUE SIENDO LA ALARMA — es lo que cuenta el
 *    badge y lo que pinta la mano roja, y por eso vive en una columna que
 *    nadie puede borrar desde Ajustes. La etiqueta «Incidencia» va ENCIMA,
 *    para verlo en la tira y filtrarlo como cualquier otra.
 *
 *    Se busca POR NOMBRE, no por un id a fuego: si alguien la renombra, esto
 *    falla en rojo y se ve, en vez de escribir en la etiqueta equivocada.
 *
 *    El insert lleva `on_conflict` Y la cabecera `resolution=ignore-duplicates`
 *    —las dos, que solo con la cabecera no funciona— porque la PK es
 *    (conversacion_id, etiqueta_id) y un cliente puede escalar dos veces.
 *
 * Los tres nodos cuelgan DETRÁS de «Marcar escalada», que a su vez es el
 * último hijo de «Preparar aviso». Así, si algo de esto falla, el aviso de
 * Telegram y la fila del Sheet ya han salido.
 *
 *   node anadir-pausa-y-etiqueta.js <vivo.json> <salida.json>
 */
const fs = require('fs')

const [, , origen, destino] = process.argv
if (!origen || !destino) {
  console.error('uso: node anadir-pausa-y-etiqueta.js <vivo.json> <salida.json>')
  process.exit(1)
}

const wf = JSON.parse(fs.readFileSync(origen, 'utf8'))

const MARCA = 'Marcar escalada'
const marca = wf.nodes.find((x) => x.name === MARCA)
if (!marca) { console.error('Falta «' + MARCA + '». Aborto.'); process.exit(1) }
if (wf.nodes.some((x) => x.name === 'Pausar al escalar')) {
  console.error('Ya está puesto. No se toca nada.'); process.exit(1)
}
if (wf.connections[MARCA]) {
  console.error('«' + MARCA + '» ya tenía salida. Míralo a mano. Aborto.'); process.exit(1)
}

const CAB = JSON.parse(JSON.stringify(marca.parameters.headerParameters))
const cliente = "{{ $('Variables').first().json.numero_cliente }}"

// ── «Marcar escalada» pasa a devolver la fila ────────────────────────────
//    Hace falta el `id` de la conversación para la etiqueta, y ya lo tiene
//    delante: pedirlo aquí ahorra una consulta.
//
//    Y CON fullResponse, que no es opcional: n8n PARTE un array JSON en un
//    item por elemento, así que sin esto `first().json` sería el objeto de la
//    conversación y no la lista, y `json[0].id` saldría undefined. Es el
//    mismo fallo que costó el arreglo de 29920d5. Con fullResponse el cuerpo
//    llega entero en `.body`.
marca.parameters.headerParameters.parameters.push({ name: 'Prefer', value: 'return=representation' })
marca.parameters.options = Object.assign({}, marca.parameters.options, {
  response: { response: { fullResponse: true } },
})

const nuevos = [
  {
    parameters: {
      method: 'PATCH',
      // El filtro es lo que impide pisar una pausa que ya estuviera puesta.
      url: '={{ $env.SUPABASE_URL }}/rest/v1/conversaciones?cliente_id=eq.' + cliente + '&bot_activo=is.true',
      sendHeaders: true,
      headerParameters: JSON.parse(JSON.stringify(CAB)),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ bot_activo: false }) }}',
      options: {},
    },
    id: 'escalar-pausar', name: 'Pausar al escalar',
    type: 'n8n-nodes-base.httpRequest', typeVersion: marca.typeVersion,
    position: [2816, 1152],
  },
  {
    parameters: {
      url: '={{ $env.SUPABASE_URL }}/rest/v1/etiquetas?nombre=eq.Incidencia&select=id',
      sendHeaders: true,
      headerParameters: JSON.parse(JSON.stringify(CAB)),
      // fullResponse por lo mismo que arriba: sin él, el array de PostgREST
      // se parte en items y `$json[0]` es undefined.
      options: { response: { response: { fullResponse: true } } },
    },
    id: 'escalar-leer-etq', name: 'Leer etiqueta Incidencia',
    type: 'n8n-nodes-base.httpRequest', typeVersion: marca.typeVersion,
    position: [3072, 1152],
  },
  {
    parameters: {
      method: 'POST',
      url: '={{ $env.SUPABASE_URL }}/rest/v1/conversacion_etiquetas?on_conflict=conversacion_id,etiqueta_id',
      sendHeaders: true,
      headerParameters: (() => {
        const c = JSON.parse(JSON.stringify(CAB))
        c.parameters.push({ name: 'Prefer', value: 'resolution=ignore-duplicates' })
        return c
      })(),
      sendBody: true,
      specifyBody: 'json',
      // Los dos salen de `.body`, que es donde deja el cuerpo fullResponse.
      // Si alguien renombra o borra la etiqueta, esto revienta en rojo — que
      // es lo que se quiere: mejor una ejecución roja que etiquetar mal.
      jsonBody:
        "={{ JSON.stringify({ conversacion_id: $('Marcar escalada').first().json.body[0].id, etiqueta_id: $('Leer etiqueta Incidencia').first().json.body[0].id }) }}",
      options: {},
    },
    id: 'escalar-poner-etq', name: 'Poner etiqueta Incidencia',
    type: 'n8n-nodes-base.httpRequest', typeVersion: marca.typeVersion,
    position: [3328, 1152],
  },
]

// Ninguno lleva onError: si la pausa o la etiqueta fallan, la ejecución sale
// en rojo y se ve. El aviso de Telegram ya salió antes, así que nadie se
// queda sin enterarse del escalado por esto.
wf.nodes = wf.nodes.concat(nuevos)

const a = (n) => [{ node: n, type: 'main', index: 0 }]
wf.connections[MARCA] = { main: [a('Pausar al escalar')] }
wf.connections['Pausar al escalar'] = { main: [a('Leer etiqueta Incidencia')] }
wf.connections['Leer etiqueta Incidencia'] = { main: [a('Poner etiqueta Incidencia')] }

const limpio = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
}
if (wf.staticData) limpio.staticData = wf.staticData

const texto = JSON.stringify(limpio)
fs.writeFileSync(destino, JSON.stringify(limpio, null, 2) + '\n', 'utf8')

console.log('Escrito: ' + destino)
console.log('  nodos: ' + wf.nodes.length + ' (antes ' + (wf.nodes.length - 3) + ')')
console.log('  cadena: Preparar aviso -> ... -> ' + MARCA +
  ' -> Pausar al escalar -> Leer etiqueta Incidencia -> Poner etiqueta Incidencia')
console.log('  el PATCH de la pausa filtra por bot_activo=is.true: ' +
  (texto.includes('bot_activo=is.true') ? 'sí' : 'NO — PARA'))
console.log('  la etiqueta se busca por nombre: ' +
  (texto.includes('nombre=eq.Incidencia') ? 'sí' : 'NO — PARA'))

// La trampa de 29920d5: leer un array de PostgREST SIN fullResponse. n8n lo
// parte en items y el `[0]` sale undefined. Los dos nodos que leen cuerpo
// tienen que llevarlo, y las expresiones tienen que ir por `.body`.
const leen = ['Marcar escalada', 'Leer etiqueta Incidencia']
let sinFull = leen.filter((n) => {
  const x = wf.nodes.find((y) => y.name === n)
  return !(x.parameters.options && x.parameters.options.response &&
           x.parameters.options.response.response &&
           x.parameters.options.response.response.fullResponse)
})
console.log('  los que leen cuerpo llevan fullResponse: ' +
  (sinFull.length ? 'NO — falta en ' + sinFull.join(', ') : 'sí'))
const porBody = texto.includes('.json.body[0].id')
console.log('  y las expresiones leen por .body: ' + (porBody ? 'sí' : 'NO — PARA'))

// Lo de hoy tiene que seguir dentro. Si no, la entrada era un espejo viejo.
const guardas = [
  ['contexto solo-referral', 'SOLO el referral del anuncio'],
  ['marca de escalado', 'Marcar escalada'],
  ['sin Esperando datos', null],
]
let mal = !texto.includes('bot_activo=is.true') ||
          !texto.includes('nombre=eq.Incidencia') ||
          sinFull.length > 0 || !porBody
for (const [que, aguja] of guardas) {
  const ok = aguja === null
    ? !texto.includes('¿Esperando datos?')
    : texto.includes(aguja)
  console.log('  sigue como debe: ' + que + ' -> ' + (ok ? 'sí' : 'NO — PARA'))
  if (!ok) mal = true
}
if (mal) process.exit(1)
