/**
 * ¿Recibe María una ubicación, o un mensaje en blanco?
 *
 * Esta prueba NO copia el código de los nodos: lo LEE de
 * `workflows/receptor-multicanal.json` y lo ejecuta. Si alguien edita el
 * nodo en n8n y exporta el flujo, la prueba comprueba lo que hay dentro
 * de verdad, no una versión paralela que se queda vieja sola.
 *
 *   node pruebas/ubicacion-en-el-receptor.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const flujo = JSON.parse(readFileSync(join(raiz, 'workflows/receptor-multicanal.json'), 'utf8'))
const codigoDe = (nombre) => {
  const n = flujo.nodes.find((z) => z.name === nombre)
  if (!n) throw new Error('no existe el nodo ' + nombre)
  return n.parameters.jsCode
}

let fallos = 0
function comprueba(que, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  const ok = a === b
  if (!ok) fallos++
  console.log((ok ? '  ok   ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + b + '\n        real:     ' + a)
}

// ── Los nodos, ejecutados como los ejecuta n8n ───────────────────────────
// n8n envuelve el código del nodo en una función async con `$json`, `$`,
// etc. en el ámbito. Reproducimos eso, sin más magia.
function normalizar(body) {
  const fn = new Function('$json', codigoDe('Normalizar evento'))
  return fn({ body }).map((i) => i.json)
}

function datosDelMensaje(ev, audio = null) {
  // El nodo referencia otros por nombre. Los que en esta rama no se han
  // ejecutado tienen que LANZAR, igual que en n8n: es justo el fallo nº 1
  // del 22 de agosto y el nodo lo captura con try/catch.
  const $ = (nombre) => {
    if (nombre === 'Normalizar evento') return { first: () => ({ json: ev }) }
    if (nombre === 'AUDIO decidir') {
      if (!audio) throw new Error("Node 'AUDIO decidir' hasn't been executed")
      return { first: () => ({ json: audio }) }
    }
    if (nombre === 'Guardar mensaje entrante') {
      return { first: () => ({ json: [{ cliente_id: ev.cliente_id, msg_id_canal: ev.wa_message_id }] }) }
    }
    throw new Error("Node '" + nombre + "' hasn't been executed")
  }
  const fn = new Function('$', codigoDe('Datos del mensaje guardado'))
  return fn($)[0].json
}

const sobre = (m) => ({
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '123', display_phone_number: '+52 55 0000 0000' },
    contacts: [{ wa_id: m.from, profile: { name: 'Adil' } }],
    messages: [m],
  } }] }],
})

// El mensaje 866 REAL, copiado de Supabase tal cual. Es el que dejó a
// María muda y el que dio origen a todo esto.
const real866 = {
  id: 'wamid.HBgLMzQ2NDE2OTEyOTkVAgASGBQzQUU2NEQzQUY0NjREQzk4NTQ4QgA=',
  from: '34641691299',
  type: 'location',
  location: { latitude: 37.065441131592, longitude: -8.8279609680176 },
  timestamp: '1787513387',
}

console.log('NORMALIZAR EVENTO — el campo `ubicacion`')
comprueba('el mensaje 866 real se normaliza', normalizar(sobre(real866))[0].ubicacion,
  { latitud: 37.065441131592, longitud: -8.8279609680176, nombre: null, direccion: null })
comprueba('con nombre y dirección los recoge',
  normalizar(sobre({ ...real866, location: { latitude: 19.4326, longitude: -99.1332, name: 'Mi casa', address: 'Av. Insurgentes Sur 123, CDMX' } }))[0].ubicacion,
  { latitud: 19.4326, longitud: -99.1332, nombre: 'Mi casa', direccion: 'Av. Insurgentes Sur 123, CDMX' })
comprueba('un texto normal no trae ubicación',
  normalizar(sobre({ id: 'x', from: '5215500000000', type: 'text', text: { body: 'hola' }, timestamp: '1787513387' }))[0].ubicacion, null)
comprueba('sin coordenadas -> null, NO 0,0',
  normalizar(sobre({ ...real866, location: {} }))[0].ubicacion, null)
comprueba('latitud CADENA VACÍA -> null, NO 0,0 (Number("") es 0)',
  normalizar(sobre({ ...real866, location: { latitude: '', longitude: '' } }))[0].ubicacion, null)
comprueba('latitud null -> null, NO 0,0 (Number(null) es 0)',
  normalizar(sobre({ ...real866, location: { latitude: null, longitude: null } }))[0].ubicacion, null)
comprueba('coordenadas en cadena numérica sí valen (así las manda a veces Meta)',
  normalizar(sobre({ ...real866, location: { latitude: '19.4326', longitude: '-99.1332' } }))[0].ubicacion,
  { latitud: 19.4326, longitud: -99.1332, nombre: null, direccion: null })
comprueba('fuera de rango -> null',
  normalizar(sobre({ ...real866, location: { latitude: 999, longitude: 0 } }))[0].ubicacion, null)
comprueba('nombre en blanco cuenta como ausente',
  normalizar(sobre({ ...real866, location: { latitude: 1, longitude: 2, name: '   ' } }))[0].ubicacion,
  { latitud: 1, longitud: 2, nombre: null, direccion: null })
comprueba('`texto` sigue vacío: en `mensajes.texto` no se escribe nada',
  normalizar(sobre(real866))[0].texto, '')

console.log()
console.log('DATOS DEL MENSAJE GUARDADO — lo que LEE María')
const leeMaria = (m, audio) => datosDelMensaje(normalizar(sobre(m))[0], audio).texto

const t866 = leeMaria(real866)
comprueba('el mensaje 866 ya NO llega en blanco', t866 !== '', true)
comprueba('y dice que es la dirección de entrega', t866.includes('dirección de entrega'), true)
comprueba('con las coordenadas exactas', t866.includes('37.065441, -8.827961'), true)
comprueba('y un enlace a Maps que se puede pulsar',
  t866.includes('https://www.google.com/maps?q=37.065441131592,-8.8279609680176'), true)

const conNombre = leeMaria({ ...real866, location: { latitude: 19.4326, longitude: -99.1332, name: 'Mi casa', address: 'Av. Insurgentes Sur 123, CDMX' } })
comprueba('el nombre del sitio llega', conNombre.includes('Lugar: Mi casa'), true)
comprueba('y la dirección escrita también',
  conNombre.includes('Dirección: Av. Insurgentes Sur 123, CDMX'), true)

comprueba('una ubicación ILEGIBLE no calla: pide la dirección escrita',
  leeMaria({ ...real866, location: {} }).includes('Pídele la dirección escrita'), true)

comprueba('un texto normal no se toca',
  leeMaria({ id: 'x', from: '5215500000000', type: 'text', text: { body: 'cuánto cuesta' }, timestamp: '1787513387' }), 'cuánto cuesta')
comprueba('el pie de foto de una imagen tampoco',
  leeMaria({ id: 'x', from: '5215500000000', type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'este me gusta' }, timestamp: '1787513387' }), 'este me gusta')
comprueba('la transcripción del audio sigue mandando (no la pisamos)',
  leeMaria({ id: 'x', from: '5215500000000', type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg' }, timestamp: '1787513387' },
    { via: 'normal', texto: 'quiero dos por favor' }), 'quiero dos por favor')

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLOS')
process.exit(fallos ? 1 : 0)
