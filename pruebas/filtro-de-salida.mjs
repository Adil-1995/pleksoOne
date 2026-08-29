/**
 * ¿Se le escapa a María el mecanismo, o una garantía que nadie autorizó?
 *
 * Esta prueba NO copia el código del nodo: lo LEE de
 * `workflows/receptor-multicanal.json` y lo ejecuta. Si alguien edita
 * `Filtro Seguridad` en n8n y exporta el flujo, aquí se comprueba lo que hay
 * dentro de verdad, no una versión paralela que se queda vieja sola.
 *
 *   node pruebas/filtro-de-salida.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const flujo = JSON.parse(readFileSync(join(raiz, 'workflows/receptor-multicanal.json'), 'utf8'))
const codigoDe = (nombre) => {
  const n = flujo.nodes.find((z) => z.name === nombre)
  if (!n) throw new Error('no existe el nodo ' + nombre)
  return n.parameters.jsCode
}

// Catálogo de mentira con la forma del de verdad. Solo los campos que el nodo
// mira. 'garantía' va CON TILDE porque así se llama la columna del Sheet: si
// alguien la busca como 'garantia' tiene que fallar aquí, no en producción.
const CATALOGO = [
  { id: 'lucessolares', activo: 'SI', nombre: 'Mini Luces LED con Carga Solar y Encendido Automático Nocturno',
    palabras_clave: 'luces, luces led, luces solares, mini luces, lamparas, las luces',
    'garantía': '6 meses', medidas: '8cm de largo, 4,5 de ancho y 4 de alto' },
  { id: 'cojinalivia', activo: 'SI', nombre: 'Cojín Alivia',
    palabras_clave: 'cojin, cojin alivia, alivia, cojin para coxis, el cojin',
    'garantía': '3 años', medidas: '' },
  { id: 'soporte360', activo: 'SI', nombre: 'Soporte Inteligente 360° con Carga Inalámbrica',
    palabras_clave: 'soporte, soporte 360, soporte inteligente, porta celular',
    'garantía': '1 año', medidas: '' }
]

function filtrar (mensajeCliente, salidaModelo, catalogo = CATALOGO) {
  const items = catalogo.map((json) => ({ json }))
  const $ = (n) => {
    if (n === 'AI Agent') return { item: { json: { output: salidaModelo } } }
    if (n === 'Añadir contexto') return { first: () => ({ json: { texto_acumulado: mensajeCliente } }) }
    if (n === 'Leer Catálogo') return { all: () => items }
    if (n === 'Variables') return { item: { json: { numero_cliente: '5215500000000' } } }
    throw new Error('nodo no simulado: ' + n)
  }
  const caja = { $, console, JSON, String, Number, Object, Array, Math, RegExp, Date }
  return runInNewContext('(function(){' + codigoDe('Filtro Seguridad') + '})()', caja)[0].json
}

let fallos = 0
function comprueba (que, real, esperado) {
  const ok = real === esperado
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + esperado + '\n        real:     ' + real)
}
const veredicto = (r) => (r.bloqueado ? 'BLOQUEADA' : 'ENVIADA')

// ── Lo que rompe que parezca humana ────────────────────────────────────────
comprueba('el cliente no puede leer que existe un catálogo',
  veredicto(filtrar('¿Tienen garantía?',
    'Sí, tiene garantía por defectos de fábrica. El catálogo no especifica la duración.')),
  'BLOQUEADA')

comprueba('ni que hay un sistema detrás',
  veredicto(filtrar('quiero pagar con tarjeta',
    'Lo siento, el sistema no me deja registrar pagos con tarjeta.')),
  'BLOQUEADA')

comprueba('"sistema" hablando del PRODUCTO sí pasa',
  veredicto(filtrar('¿cómo funcionan?',
    'Llevan un sistema de sensor que las enciende solas al anochecer 😊')),
  'ENVIADA')

// ── Garantías ──────────────────────────────────────────────────────────────
comprueba('la garantía de las luces, que consta, se envía',
  veredicto(filtrar('¿Cuál es la garantía de las luces solares?',
    'Sí 😊 Las luces solares tienen garantía de 6 meses por defectos de fábrica.')),
  'ENVIADA')

comprueba('la del cojín, que también consta, se envía',
  veredicto(filtrar('¿Cuál es la garantía del cojin?',
    'El cojín Alivia tiene garantía de 3 años por defectos de fábrica 😊')),
  'ENVIADA')

const sinGarantia = JSON.parse(JSON.stringify(CATALOGO))
sinGarantia.find((p) => p.id === 'cojinalivia')['garantía'] = ''
comprueba('con el campo VACÍO, afirmar una garantía se bloquea',
  veredicto(filtrar('¿Cuál es la garantía del cojin?',
    'El cojín Alivia tiene garantía por defectos de fábrica 😊', sinGarantia)),
  'BLOQUEADA')

comprueba('con el campo vacío, NO afirmar nada sí pasa',
  veredicto(filtrar('¿Cuál es la garantía del cojin?',
    'Permítame confirmarlo con el equipo y le digo enseguida 😊', sinGarantia)),
  'ENVIADA')

// ── Medidas: el dato que antes no llegaba al modelo ────────────────────────
comprueba('dar las medidas es una respuesta normal, no se bloquea',
  veredicto(filtrar('La medida por favor',
    'Claro 😊 Las mini luces miden 8 cm de largo, 4,5 de ancho y 4 de alto.')),
  'ENVIADA')

// ── Lo que ya funcionaba, que siga funcionando ─────────────────────────────
comprueba('enumerar dos productos se sigue bloqueando',
  veredicto(filtrar('¿qué venden?',
    'Tenemos las Mini Luces LED solares y también el Soporte Inteligente 360°.')),
  'BLOQUEADA')

// ── La respuesta bloqueada tiene que quedar guardada ───────────────────────
const r = filtrar('¿Tienen garantía?',
  'Sí, tiene garantía por defectos de fábrica. El catálogo no especifica la duración.')
comprueba('se conserva lo que María INTENTÓ decir, para verlo en Incidencias',
  r.respuesta_bloqueada.includes('El catálogo no especifica'), true)
comprueba('y al cliente le llega otra cosa',
  r.respuesta_final.includes('catálogo'), false)

console.log(fallos === 0 ? '\nTodo en orden.' : '\n' + fallos + ' FALLOS')
process.exit(fallos === 0 ? 0 : 1)
