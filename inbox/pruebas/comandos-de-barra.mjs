/**
 * Los comandos de «/»: cuándo se abre el desplegable y qué ofrece.
 *
 * Esta prueba NO copia el código: lee `src/lib/respuestas.ts` de verdad y lo
 * ejecuta. Se le quita el import del cliente de Supabase —que pediría las
 * variables de entorno y no pinta nada aquí— y el resto va tal cual, así que
 * si alguien cambia el filtrado, esto se entera.
 *
 *   node pruebas/comandos-de-barra.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { transformSync } from 'esbuild'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const fuente = readFileSync(join(raiz, 'src/lib/respuestas.ts'), 'utf8')

// Fuera el cliente de Supabase y las funciones que lo usan: aquí se prueba la
// lógica pura (cuándo abre, cómo filtra, cómo se limpia el atajo), que es la
// que puede romperse en silencio.
const soloLogica = fuente
  .replace(/^import[\s\S]*?from '.\/supabase'$/m, '')
  .replace(/^import type[\s\S]*?from '@\/tipos'$/m, '')
  .replace(/export async function [\s\S]*?\n}\n/g, '')

const { code } = transformSync(soloLogica, { loader: 'ts', format: 'esm' })
const modulo = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)
const { filtroDe, filtrarRespuestas, normalizarAtajo, ATAJO_VALIDO } = modulo

let fallos = 0
function comprueba(que, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado)
  const ok = a === b
  if (!ok) fallos++
  console.log((ok ? '  ok    ' : '  FALLO ') + que)
  if (!ok) console.log('        esperado: ' + b + '\n        real:     ' + a)
}

// ── Cuándo sale la lista ───────────────────────────────────────────────────
comprueba('la barra sola la abre, sin filtro', filtroDe('/'), '')
comprueba('«/env» la abre filtrando por env', filtroDe('/env'), 'env')
comprueba('campo vacío, cerrada', filtroDe(''), null)
comprueba('texto normal, cerrada', filtroDe('hola'), null)

// Lo que evita que aparezca sola a media frase:
comprueba('una fecha con barras NO la abre', filtroDe('llega el 3/9'), null)
comprueba('«y/o» a media frase NO la abre', filtroDe('efectivo y/o tarjeta'), null)
comprueba('en cuanto hay un espacio, se cierra', filtroDe('/envio ya'), null)
comprueba('una barra que no va la primera, cerrada', filtroDe(' /envio'), null)

// ── Cómo filtra ────────────────────────────────────────────────────────────
const CATALOGO = [
  { id: 1, atajo: 'reenviar', texto: 'Se lo reenvío' },
  { id: 2, atajo: 'envio',    texto: 'Envío gratis' },
  { id: 3, atajo: 'pago',     texto: 'Se paga al recibir' },
  { id: 4, atajo: 'dirección', texto: 'Su dirección es' },
]
const atajos = (l) => l.map((r) => r.atajo)

comprueba('sin filtro salen todas y en su orden',
  atajos(filtrarRespuestas(CATALOGO, '')),
  ['reenviar', 'envio', 'pago', 'dirección'])

// Lo importante: escribiendo «env» interesa más «/envio» que «/reenviar»,
// aunque las dos contengan «env» y «reenviar» vaya antes en la lista.
comprueba('las que EMPIEZAN por lo escrito van primero',
  atajos(filtrarRespuestas(CATALOGO, 'env')),
  ['envio', 'reenviar'])

comprueba('sin distinguir mayúsculas',
  atajos(filtrarRespuestas(CATALOGO, 'PAG')),
  ['pago'])

comprueba('sin distinguir tildes: «direccion» encuentra «dirección»',
  atajos(filtrarRespuestas(CATALOGO, 'direccion')),
  ['dirección'])

comprueba('lo que no existe no devuelve nada',
  atajos(filtrarRespuestas(CATALOGO, 'zzz')),
  [])

// ── El atajo que se guarda ─────────────────────────────────────────────────
comprueba('se guarda sin la barra aunque la escribas', normalizarAtajo('/envio'), 'envio')
comprueba('se quitan los espacios de los lados', normalizarAtajo('  envio  '), 'envio')
comprueba('varias barras seguidas también', normalizarAtajo('//envio'), 'envio')

// Lo mismo que impone el CHECK de la tabla, para que el formulario no deje
// mandar algo que la base va a rechazar con un error feo.
comprueba('un atajo normal vale', ATAJO_VALIDO.test('envio'), true)
comprueba('con espacio NO vale', ATAJO_VALIDO.test('envio ya'), false)
comprueba('con barra NO vale', ATAJO_VALIDO.test('en/vio'), false)
comprueba('vacío NO vale', ATAJO_VALIDO.test(''), false)
comprueba('más de 24 caracteres NO vale', ATAJO_VALIDO.test('a'.repeat(25)), false)

console.log(fallos === 0 ? '\nTodo en orden.' : '\n' + fallos + ' FALLOS')
process.exit(fallos === 0 ? 0 : 1)
